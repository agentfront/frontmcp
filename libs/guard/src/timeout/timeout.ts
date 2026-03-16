/**
 * Timeout Utility
 *
 * Wraps an async function with a deadline using AbortController + Promise.race.
 */

import { ExecutionTimeoutError } from '../errors';

/**
 * Execute a function with a timeout. Throws ExecutionTimeoutError if exceeded.
 */
export async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, entityName: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new ExecutionTimeoutError(entityName, timeoutMs));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
