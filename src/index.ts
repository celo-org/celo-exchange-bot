import { EnvVar, fetchEnv, fetchEnvBigNumber, fetchEnvBigNumberOrDefault, fetchEnvOrDefault, getSourceAddress, getTargetAddress, getStableToken, fetchEnvBool } from './env'
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
    const stableTokenInstance = await kit.contracts.getStableToken(stableToken)
    const sourceAddress = getSourceAddress()
    const mentoInstance = await kit.contracts.getExchange(stableToken)
    const celoTokenInstance = await kit.contracts.getGoldToken()
    
    
    const sellCELO = fetchEnvBool(EnvVar.EXCHANGE_SELL_CELO)
    
    let soldableAsset, buyableAsset, sellMinRateStableTokenPerCELO
    let amountToSell:BigNumber
    
    if (sellCELO){
      soldableAsset = await celoTokenInstance
      buyableAsset = await stableTokenInstance
      amountToSell = fetchEnvBigNumber(EnvVar.EXCHANGE_AMOUNT_CELO)
      sellMinRateStableTokenPerCELO = fetchEnvBigNumber(EnvVar.EXCHANGE_MINRATE_STABLETOKEN_PER_CELO) // sellMinRateStableTokenPerCELO
    } else {
      soldableAsset = await stableTokenInstance
      buyableAsset = await celoTokenInstance
      amountToSell = fetchEnvBigNumber(EnvVar.EXCHANGE_AMOUNT_STABLE)
      sellMinRateStableTokenPerCELO = (new BigNumber(1)).div(fetchEnvBigNumber(EnvVar.EXCHANGE_MINRATE_STABLETOKEN_PER_CELO))
      
    }


    // Check how much we can exchange (keep 1 CELO for gas if selling CELO for stable (minting)).
    const amountToKeep = sellCELO ? new BigNumber('1e18') : new BigNumber('0')
    const availableBalance = (await soldableAsset.balanceOf(sourceAddress)).minus(amountToKeep)
    if (availableBalance.lte(new BigNumber(0))) {
      rootLogger.warn({ soldableAsset, availableBalance }, "Insufficient available balance to exchange")
      return
    }

    let sellAmount = BigNumber.min(availableBalance, amountToSell)


    // Figure out the minimum stableToken we want to acquire for that.
    const forAtLeastStableToken = sellAmount.multipliedBy(sellMinRateStableTokenPerCELO).integerValue(BigNumber.ROUND_FLOOR)

    let quotedRate
    if (sellCELO){
      quotedRate = new BigNumber(1).div(await mentoInstance.getGoldExchangeRate(sellAmount))
    } else {
      quotedRate = new BigNumber(1).div(await mentoInstance.getStableExchangeRate(sellAmount))
    }

    if (quotedRate.lt(sellMinRateStableTokenPerCELO)) {
      rootLogger.info({
        sellAmount,
        forAtLeastStableToken,
        quotedRate,
      }, "Quoted rate too low to exchange")
      return
    }

    // Increase allowance
    const allowanceReceipt = await soldableAsset.increaseAllowance(mentoInstance.address, sellAmount.toFixed()).sendAndWaitForReceipt()
    rootLogger.debug({
      allowanceReceipt,
      target: mentoInstance.address,
      allowanceIncreaseAmount: sellAmount,
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
      sellAmount.multipliedBy(
        quotedRate.multipliedBy(new BigNumber(1).minus(maxAllowedSlippage))
      ).integerValue(BigNumber.ROUND_FLOOR),
      forAtLeastStableToken
    )
    

    // Exchange
    const exchangeReceipt = await mentoInstance.exchange(sellAmount.toFixed(), minStableTokenOut.toFixed(), sellCELO).sendAndWaitForReceipt()
    const sourceBalanceCELO = await celoTokenInstance.balanceOf(sourceAddress)
    rootLogger.info({
      exchangeReceipt,
      sourceBalanceCELO,
      sellAmount,
      minStableTokenOut,
      quotedRate
    }, `Exchange (${soldableAsset} for ${buyableAsset}) succeeded`)
  } catch (err) {
    rootLogger.error({ err }, "This exchange failed")
  }
}

async function transfer() {
  try {
    const sellCELO = fetchEnvBool(EnvVar.EXCHANGE_SELL_CELO)
    let transferableToken
    if (sellCELO){
      const stableToken = getStableToken()
      const stableTokenInstace = await kit.contracts.getStableToken(stableToken)
      transferableToken = stableTokenInstace
    } else {
      transferableToken = await kit.contracts.getGoldToken()
    }



    const sourceAddress = getSourceAddress()
    const sourceStableTokenBalance = await transferableToken.balanceOf(sourceAddress)
    const targetAddress = getTargetAddress()

    if (sourceStableTokenBalance.gt(MIN_STABLE_TOKEN_TRANSFER_AMOUNT)) {
      rootLogger.info({
        transferableToken,
        sourceStableTokenBalance,
        sourceAddress,
        targetAddress,
      }, `Transferring entire balance of ${transferableToken} from source to target`)

      const transferReceipt = await transferableToken.transfer(targetAddress, sourceStableTokenBalance.toFixed()).sendAndWaitForReceipt()
      const targetStableTokenBalance = await transferableToken.balanceOf(targetAddress)
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
