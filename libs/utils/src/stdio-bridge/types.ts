/** Where a stdio bridge logs: never stdout, which carries the JSON-RPC frames. */
export interface BridgeLogger {
  readonly path: string | undefined;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  reloadEvent(kind: string, data?: Record<string, unknown>): void;
  close(): Promise<void>;
}
