// common/types/options/logging/interfaces.ts
// Explicit TypeScript interfaces for logging configuration

import { LogTransportType } from '../../../interfaces';

/**
 * Log level enumeration.
 *
 * Note: Trace is a special level for structured TUI/dashboard events.
 * It's always emitted to ManagerLogTransport regardless of configured level.
 */
export enum LogLevel {
  Trace = -1, // Special: structured events for TUI (always emitted to ManagerLogTransport)
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
  [LogLevel.Trace]: 'trace',
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
