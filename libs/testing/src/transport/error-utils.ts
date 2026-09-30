/**
 * @file error-utils.ts
 * @description Realm-safe error helpers.
 *
 * Under Jest the test code runs in a `vm` context while `fetch` (undici) throws errors created in
 * the outer realm, so `err instanceof Error` is false for a perfectly good `AbortError`. Everything
 * here duck-types instead of relying on `instanceof`.
 */

export function errorName(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

export function isAbortError(err: unknown): boolean {
  return errorName(err) === 'AbortError';
}

export function errorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (typeof err === 'string' && err) return err;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

const interceptedErrors = new WeakSet<object>();

/** Tag an error produced by a request interceptor so the client rethrows it instead of wrapping it. */
export function markInterceptedError<T extends object>(err: T): T {
  interceptedErrors.add(err);
  return err;
}

export function isInterceptedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && interceptedErrors.has(err);
}
