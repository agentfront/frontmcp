// common/types/options/logging/interfaces.ts
// Explicit TypeScript interfaces for logging configuration

import { LogTransportType } from '../../../interfaces';

/**
 * Log level enumeration.
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
