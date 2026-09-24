/**
 * Timeout Utility
 *
 * Wraps an async function with a deadline using AbortController + Promise.race.
 */

import { ExecutionTimeoutError } from '../errors';

/**
 * Execute a function with a timeout. Throws ExecutionTimeoutError if exceeded.
 *
 * The function receives an AbortSignal that is aborted when the deadline passes,
 * so work that observes it can stop instead of running on after the timeout.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  entityName: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ExecutionTimeoutError(entityName, timeoutMs)), timeoutMs);

  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
