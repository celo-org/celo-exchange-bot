import Logger, { createLogger, LogLevelString, stdSerializers } from 'bunyan'
import { fetchEnvOrDefault } from './env'

const logLevel = fetchEnvOrDefault('LOG_LEVEL', 'info') as LogLevelString

let stream: any = { stream: process.stdout, level: logLevel }

export const rootLogger: Logger = createLogger({
  name: 'exchanger-service',
  serializers: stdSerializers,
  streams: [stream],
})
