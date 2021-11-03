import { EnvVar, fetchEnv, fetchEnvBigNumber, fetchEnvBigNumberOrDefault, fetchEnvOrDefault, getSourceAddress, getTargetAddress, getStableToken } from './env'
import { rootLogger } from './logger'
import { ContractKit, newKit } from '@celo/contractkit'
import { AzureHSMWallet } from '@celo/wallet-hsm-azure'
import { Block } from 'web3-eth'
import BigNumber from 'bignumber.js'

const MIN_STABLE_TOKEN_TRANSFER_AMOUNT = new BigNumber('1e17')

let kit: ContractKit

async function initializeKit() {
  if (kit === undefined) {
    // Initialize wallet
    const akvWallet = new AzureHSMWallet(fetchEnv(EnvVar.AZURE_VAULT_NAME))
    await akvWallet.init()

    kit = newKit(fetchEnv(EnvVar.CELO_PROVIDER), akvWallet)
    
    // Copied from @celo/cli/src/utils/helpers
    try {
      const isSyncing = await kit.web3.eth.isSyncing()
      if (typeof isSyncing === 'boolean' && !isSyncing) {
        const latestBlock: Block = await kit.web3.eth.getBlock('latest')
        if (latestBlock && latestBlock.number > 0) {
          // To catch the case in which syncing has happened in the past,
          // has stopped, and hasn't started again, check for an old timestamp
          // on the latest block
          const ageOfBlock = Date.now() / 1000 - Number(latestBlock.timestamp)
          if (ageOfBlock > 120) {
            throw new Error(
              `Latest block is ${ageOfBlock} seconds old, and syncing is not currently in progress`
            )
          }
        }
      } else {
        throw new Error('Node is not synced')
      }
    } catch (err) {
      rootLogger.error({
        err
      },
        'Initializing Kit failed, are you running your node and specified it with the "CELO_PROVIDER" env var?. It\' currently set as ' +
          fetchEnv(EnvVar.CELO_PROVIDER)
      )
      throw err
    }
  }
}

async function exchange() {
  try {
    const stableToken = getStableToken()
    const sourceAddress = getSourceAddress()
    const sellMinRateStableTokenPerCELO = fetchEnvBigNumber(EnvVar.EXCHANGE_MINRATE_STABLETOKEN_PER_CELO)
    const mentoInstance = await kit.contracts.getExchange(stableToken)
    const celoTokenInstance = await kit.contracts.getGoldToken()

    // Check how much we can buy (always keep 1CG for gas).
    const realBalanceCELO = await celoTokenInstance.balanceOf(sourceAddress)
    const availableBalanceCELO = realBalanceCELO.minus(new BigNumber('1e18'))
    if (availableBalanceCELO.lt(new BigNumber(0))) {
      rootLogger.warn({ realBalanceCELO, availableBalanceCELO }, "Insufficient available balance to exchange")
      return
    }

    let sellAmountCELO = BigNumber.min(availableBalanceCELO, fetchEnvBigNumber(EnvVar.EXCHANGE_AMOUNT_CELO))

    // Figure out the minimum stableToken we want to acquire for that.
    const forAtLeastStableToken = sellAmountCELO.multipliedBy(sellMinRateStableTokenPerCELO).integerValue(BigNumber.ROUND_FLOOR)

    const quotedRate = new BigNumber(1).div(await mentoInstance.getGoldExchangeRate(sellAmountCELO))
    if (quotedRate.lt(sellMinRateStableTokenPerCELO)) {
      rootLogger.info({
        sellAmountCELO,
        forAtLeastStableToken,
        quotedRate,
      }, "Quoted rate too low to exchange")
      return
    }

    // Increase allowance
    const allowanceReceipt = await celoTokenInstance.increaseAllowance(mentoInstance.address, sellAmountCELO.toFixed()).sendAndWaitForReceipt()
    rootLogger.debug({
      allowanceReceipt,
      target: mentoInstance.address,
      allowanceIncreaseAmount: sellAmountCELO,
    }, "Increased CELO token allowance to Mento")

    // To do our best to prevent sandwich attacks, prefer to set the min stable token out amount
    // based off a configurable max allowed slippage compared to the current on-chain price
    // rather than the absolute worst price this bot finds acceptable.
    const maxAllowedSlippage = fetchEnvBigNumber(EnvVar.EXCHANGE_MAX_ALLOWED_SLIPPAGE)
    // e.g. sellAmountCELO = 10, quotedRate = 5.00, maxAllowedSlippage = 0.01, sellMinRateStableTokenPerCELO = 4.00:
    // max(
    //   10 * (5.00 * (1 - 0.01)), // 49.5
    //   10 * 4.00 // 40.0
    // ) = 49.5
    const minStableTokenOut = BigNumber.max(
      sellAmountCELO.multipliedBy(
        quotedRate.multipliedBy(new BigNumber(1).minus(maxAllowedSlippage))
      ).integerValue(BigNumber.ROUND_FLOOR),
      forAtLeastStableToken
    )

    // Exchange
    const exchangeReceipt = await mentoInstance.exchange(sellAmountCELO.toFixed(), minStableTokenOut.toFixed(), true).sendAndWaitForReceipt()
    const sourceBalanceCELO = await celoTokenInstance.balanceOf(sourceAddress)
    rootLogger.info({
      exchangeReceipt,
      sourceBalanceCELO,
      sellAmountCELO,
      minStableTokenOut,
      quotedRate
    }, `Exchange (CELO for ${stableToken}) succeeded`)
  } catch (err) {
    rootLogger.error({ err }, "This exchange failed")
  }
}

async function transfer() {
  try {
    const stableToken = getStableToken()
    const stableTokenInstace = await kit.contracts.getStableToken(stableToken)

    const sourceAddress = getSourceAddress()
    const sourceStableTokenBalance = await stableTokenInstace.balanceOf(sourceAddress)
    const targetAddress = getTargetAddress()

    if (sourceStableTokenBalance.gt(MIN_STABLE_TOKEN_TRANSFER_AMOUNT)) {
      rootLogger.info({
        stableToken,
        sourceStableTokenBalance,
        sourceAddress,
        targetAddress,
      }, 'Transferring entire stable token balance from source to target')

      const transferReceipt = await stableTokenInstace.transfer(targetAddress, sourceStableTokenBalance.toFixed()).sendAndWaitForReceipt()
      const targetStableTokenBalance = await stableTokenInstace.balanceOf(targetAddress)
      rootLogger.info({
        transferReceipt,
        targetStableTokenBalance
      }, 'Transfer successful')
    }
  } catch (err) {
    rootLogger.error({ err }, "This transfer failed")
  }
}

function scheduleNextExchange() {
  setTimeout(() => {
    exchange().then(scheduleNextExchange)
  }, 1000 * parseInt(fetchEnvOrDefault(EnvVar.EXCHANGE_SECS, '15'), 10))
}

function scheduleNextTransfer() {
  setTimeout(() => {
    transfer().then(scheduleNextTransfer)
  }, 1000 * parseInt(fetchEnvOrDefault(EnvVar.TRANSFER_SECS, '7200'), 10))
}

async function init() {
  await initializeKit()
  kit.defaultAccount = getSourceAddress()
  kit.gasInflationFactor = fetchEnvBigNumberOrDefault(EnvVar.GAS_INFLATION_FACTOR, '2.0').toNumber()

  rootLogger.info('Exchanger service started.')

  // TODO add listeners.

  scheduleNextExchange()
  scheduleNextTransfer()
}

init().catch((err) => {
  rootLogger.error({ err })
  process.exit(1)
})
