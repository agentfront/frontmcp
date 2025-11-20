/// <reference types="jest" />
/**
 * Helper utilities for testing asynchronous operations
 */

/**
 * Waits for a promise to settle and returns the result or error
 */
export async function settled<T>(promise: Promise<T>): Promise<
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: any }
> {
  try {
    const value = await promise;
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

/**
 * Waits for a condition to be true with a timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Flushes all pending promises (useful for testing async flows)
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Creates a deferred promise that can be resolved/rejected externally
 */
export function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

/**
 * Runs a function and expects it to throw an error
 */
export async function expectToThrow<T>(
  fn: () => T | Promise<T>,
  expectedError?: string | RegExp | (new (...args: any[]) => Error)
): Promise<Error> {
  try {
    await fn();
    throw new Error('Expected function to throw an error, but it did not');
  } catch (error) {
    if (expectedError) {
      if (typeof expectedError === 'string') {
        expect((error as Error).message).toContain(expectedError);
      } else if (expectedError instanceof RegExp) {
        expect((error as Error).message).toMatch(expectedError);
      } else {
        expect(error).toBeInstanceOf(expectedError);
      }
    }
    return error as Error;
  }
}

/**
 * Creates a mock function that tracks calls
 */
export function createMockFn<T extends (...args: any[]) => any>() {
  const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: any }> = [];

  const fn = jest.fn((...args: Parameters<T>): ReturnType<T> => {
    const call: any = { args };
    try {
      const result = undefined as ReturnType<T>;
      call.result = result;
      calls.push(call);
      return result;
    } catch (error) {
      call.error = error;
      calls.push(call);
      throw error;
    }
  });

  return {
    fn,
    calls,
    reset: () => {
      calls.length = 0;
      fn.mockReset();
    },
  };
}
