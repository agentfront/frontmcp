/**
 * CIMD Logger Interface
 *
 * A generic logger interface that FrontMcpLogger already satisfies.
 * This allows CIMD to be used independently of the SDK.
 */

/**
 * Logger interface for CIMD service.
 *
 * This interface is compatible with FrontMcpLogger and most common
 * logging libraries (winston, pino, bunyan, etc.).
 */
export interface CimdLogger {
  /**
   * Create a child logger with a prefix.
   */
  child(prefix: string): CimdLogger;

  /**
   * Log a debug message.
   */
  debug(message: string, ...args: unknown[]): void;

  /**
   * Log an info message.
   */
  info(message: string, ...args: unknown[]): void;

  /**
   * Log a warning message.
   */
  warn(message: string, ...args: unknown[]): void;

  /**
   * Log an error message.
   */
  error(message: string, ...args: unknown[]): void;
}

/**
 * No-op logger implementation for when logging is not needed.
 */
export const noopLogger: CimdLogger = {
  child: () => noopLogger,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
