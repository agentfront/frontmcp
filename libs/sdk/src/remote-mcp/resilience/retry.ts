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

      // Calculate delay
      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier,
        opts.jitterFactor,
      );

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

/**
 * Common retryable error detection for MCP operations
 */
export function isTransientError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Network errors
  if (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // Timeout errors
  if (message.includes('timeout') || name.includes('timeout')) {
    return true;
  }

  // Temporary server errors (5xx)
  if (
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout')
  ) {
    return true;
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  return false;
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
