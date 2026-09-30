/**
 * Permanent, rate-limited 'error' listener for ioredis clients.
 *
 * ioredis emits 'error' for every failed reconnect attempt. With no listener it
 * prints "[ioredis] Unhandled error event" once per attempt, which floods logs
 * while Redis is down. This listener swallows the event and logs at most once
 * per interval, counting the errors it suppressed.
 */

export interface RedisErrorListenerOptions {
  /** Name used in the log line, e.g. 'HA'. */
  label?: string;
  /** Logger to write to. Falls back to `console.warn`. */
  logger?: { warn: (message: string, ...meta: unknown[]) => void };
  /** Minimum time between two log lines. Defaults to 30 seconds. */
  intervalMs?: number;
}

export interface ErrorEmitterClient {
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

export const DEFAULT_REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * Attach the listener and return a function that removes it.
 */
export function attachRedisErrorListener(
  client: ErrorEmitterClient,
  options: RedisErrorListenerOptions = {},
): () => void {
  const label = options.label ?? 'redis';
  const intervalMs = options.intervalMs ?? DEFAULT_REDIS_ERROR_LOG_INTERVAL_MS;
  let lastLoggedAt = 0;
  let suppressed = 0;

  const listener = (error: Error): void => {
    const now = Date.now();
    if (lastLoggedAt !== 0 && now - lastLoggedAt < intervalMs) {
      suppressed++;
      return;
    }
    const extra = suppressed > 0 ? ` (${suppressed} similar error(s) suppressed)` : '';
    suppressed = 0;
    lastLoggedAt = now;
    const message = `[${label}] Redis connection error: ${error?.message ?? String(error)}${extra}`;
    if (options.logger) {
      options.logger.warn(message);
    } else {
      console.warn(message);
    }
  };

  client.on('error', listener);
  return () => {
    client.removeListener('error', listener);
  };
}
