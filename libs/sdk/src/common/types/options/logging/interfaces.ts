// common/types/options/logging/interfaces.ts
// Explicit TypeScript interfaces for logging configuration

import { type LogTransportType } from '../../../interfaces';

/**
 * Log level enumeration, from the most detailed level to the least: `Verbose`, `Debug`, `Info`, `Warn`, `Error`.
 * A logger at a level logs that level and every level after it, so `Verbose` logs `debug()` lines too.
 * The numeric values predate that order and are kept as they are: `Verbose` is 1 and `Debug` 0.
 */
export enum LogLevel {
  Debug = 0,
  Verbose = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Off = 100, // never log
}

/**
 * Log level display names.
 */
export const LogLevelName: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Verbose]: 'verbose',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Off]: 'off',
};

/**
 * Logging configuration options.
 */
export interface LoggingOptionsInterface {
  /**
   * Minimum log level to output.
   * @default LogLevel.Info
   */
  level?: LogLevel;

  /**
   * Enable console output.
   * @default true
   */
  enableConsole?: boolean;

  /**
   * Prefix for log messages.
   */
  prefix?: string;

  /**
   * Additional custom LogTransport types to register.
   * @default []
   */
  transports?: LogTransportType[];
}
