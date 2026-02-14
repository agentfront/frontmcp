/**
 * Logger interface for auth library components.
 * Decouples auth from SDK's FrontMcpLogger.
 */
export interface AuthLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/**
 * No-op logger that discards all messages.
 */
export const noopAuthLogger: AuthLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
