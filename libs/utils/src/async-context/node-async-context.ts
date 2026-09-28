export { AsyncLocalStorage } from 'node:async_hooks';
export { AsyncContextOverlapError } from './overlap-error';

/** How the runtime keeps async context apart: Node and Workers propagate it natively. */
export type AsyncContextMode = 'native' | 'serialized';

export function getAsyncContextMode(): AsyncContextMode {
  return 'native';
}

/**
 * Run one top-level request. Node propagates `AsyncLocalStorage` across awaits, so requests may
 * overlap freely and this only calls `fn`.
 */
export async function runRequestExclusive<R>(fn: () => R | Promise<R>): Promise<R> {
  return fn();
}

/** Await something a request waits on from outside (a client's answer). A pass-through on Node. */
export async function awaitOutsideRequest<T>(promise: PromiseLike<T>): Promise<T> {
  return promise;
}
