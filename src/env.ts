import * as dotenv from 'dotenv'
import { isValidAddress, toChecksumAddress } from 'ethereumjs-util'
import { StableToken } from '@celo/contractkit'
import BigNumber from 'bignumber.js'

export enum EnvVar {
  AZURE_VAULT_NAME = 'AZURE_VAULT_NAME',
  CELO_PROVIDER = 'CELO_PROVIDER',
  CONFIG = 'CONFIG',
  GAS_INFLATION_FACTOR = 'GAS_INFLATION_FACTOR',
  EXCHANGE_AMOUNT_CELO = 'EXCHANGE_AMOUNT_CELO',
  EXCHANGE_MAX_ALLOWED_SLIPPAGE = 'EXCHANGE_MAX_ALLOWED_SLIPPAGE',
  EXCHANGE_MINRATE_STABLETOKEN_PER_CELO = 'EXCHANGE_MINRATE_STABLETOKEN_PER_CELO',
  EXCHANGE_SECS = 'EXCHANGE_SECS',
  EXCHANGE_SOURCE_ADDRESS = 'EXCHANGE_SOURCE_ADDRESS',
  EXCHANGE_TARGET_ADDRESS = 'EXCHANGE_TARGET_ADDRESS',
  STABLE_TOKEN = 'STABLE_TOKEN',
  TRANSFER_SECS = 'TRANSFER_SECS',
}

if (process.env[EnvVar.CONFIG]) {
  dotenv.config({ path: process.env[EnvVar.CONFIG] })
}

export function fetchEnv(name: string): string {
  if (process.env[name] === undefined || process.env[name] === '') {
    logErrorAndThrow(`ENV var '${name}' was not defined`)
  }
  return process.env[name] as string
}

export function fetchEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name] === undefined || process.env[name] === ''
    ? defaultValue
    : (process.env[name] as string)
}

export function fetchEnvAddress(name: string): string {
  const value = fetchEnv(name)
  if (
    value === undefined ||
    !isValidAddress(value)
  ) {
    logErrorAndThrow(`Did not specify valid ${name}, got value: ${value}`)
  }
  return toChecksumAddress(value)
}

export function fetchEnvBigNumber(name: string): BigNumber {
  return new BigNumber(fetchEnv(name))
}

export function fetchEnvBigNumberOrDefault(name: string, stringValue: string): BigNumber {
  return new BigNumber(fetchEnvOrDefault(name, stringValue))
}

export function getTargetAddress() {
  return fetchEnvAddress(EnvVar.EXCHANGE_TARGET_ADDRESS)
}

export function getSourceAddress() {
  return fetchEnvAddress(EnvVar.EXCHANGE_SOURCE_ADDRESS)
}

export function getStableToken(): StableToken {
  let stableToken = fetchEnv(EnvVar.STABLE_TOKEN) as StableToken
  if (!(stableToken in StableToken)) {
    throw new Error(`Invalid stableToken ${stableToken}`)
  }
  return stableToken
}

function logErrorAndThrow(errorString: string) {
  console.error(errorString)
  throw new Error(errorString)
}