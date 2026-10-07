/**
 * @file retry.ts
 * @description Retry utilities with exponential backoff for resilient remote MCP operations
 */

import { InvalidRetryOptionsError } from '../../errors/remote.errors';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitterFactor?: number;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: Error) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  isRetryable: () => true,
  onRetry: () => {},
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number,
): number {
  // Exponential backoff
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry logic and exponential backoff
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

  // Validate maxAttempts to ensure type safety
  if (opts.maxAttempts < 1) {
    throw new InvalidRetryOptionsError('maxAttempts', opts.maxAttempts, 'must be at least 1');
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (attempt >= opts.maxAttempts || !opts.isRetryable(lastError)) {
        throw lastError;
      }

      const retryAfterMs = remoteHttpFailureOf(lastError)?.retryAfterMs;
      const delayMs =
        retryAfterMs !== undefined
          ? Math.min(retryAfterMs, opts.maxDelayMs)
          : calculateDelay(attempt, opts.initialDelayMs, opts.maxDelayMs, opts.backoffMultiplier, opts.jitterFactor);

      // Notify retry callback
      opts.onRetry(attempt, lastError, delayMs);

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // This code path can only be reached if maxAttempts >= 1 and no errors occurred,
  // but all successful attempts return early. For type safety, provide a fallback.
  throw lastError ?? new Error('No error captured during retry');
}

/** How a remote answered a request that failed over HTTP: its status, and the wait its `Retry-After` asked for. */
export interface RemoteHttpFailure {
  status: number;
  retryAfterMs?: number;
}

interface HttpFailureFields {
  http?: Partial<RemoteHttpFailure>;
  code?: unknown;
  originalError?: unknown;
  cause?: unknown;
  message?: unknown;
}

const LEGACY_SSE_STATUS = /\(HTTP (\d{3})\)/;

/**
 * The HTTP failure behind `error` or an error it wraps (`originalError`, `cause`): the `http` the
 * 2026-07-28 client records, the numeric `code` of the Streamable HTTP and SSE transports' errors (a
 * JSON-RPC code is negative), or the `(HTTP 503)` the legacy SSE transport writes in its message.
 */
export function remoteHttpFailureOf(error: unknown): RemoteHttpFailure | undefined {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const fields = current as HttpFailureFields;
    if (typeof fields.http?.status === 'number') return { ...fields.http, status: fields.http.status };
    const legacyStatus = typeof fields.message === 'string' ? LEGACY_SSE_STATUS.exec(fields.message)?.[1] : undefined;
    const status = typeof fields.code === 'number' ? fields.code : Number(legacyStatus);
    if (status >= 100 && status <= 599) return { status };
    current = fields.originalError ?? fields.cause;
  }
  return undefined;
}

/** Statuses worth another try: request timeout, too early, too many requests, and server errors but 501 and 505. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status !== 501 && status !== 505);
}

/**
 * Whether a failed remote operation is worth another try: by the HTTP status the remote answered with,
 * else when the request failed on the network or timed out.
 */
export function isTransientError(error: Error): boolean {
  const httpFailure = remoteHttpFailureOf(error);
  if (httpFailure) return isTransientStatus(httpFailure.status);

  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';
  return (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    name.includes('timeout')
  );
}

/**
 * Check if error is a connection error (requires reconnection)
 */
export function isConnectionError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';

  return (
    message.includes('not connected') ||
    message.includes('connection closed') ||
    message.includes('connection lost') ||
    message.includes('econnreset') ||
    message.includes('socket closed') ||
    message.includes('transport')
  );
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';

  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('invalid token')
  );
}
