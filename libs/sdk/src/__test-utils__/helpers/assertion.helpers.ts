/// <reference types="jest" />
/**
 * Custom assertion helpers for testing SDK components
 */

/**
 * Asserts that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected value to be defined');
  }
}

/**
 * Asserts that a value is an instance of a class
 */
export function assertInstanceOf<T>(
  value: any,
  constructor: new (...args: any[]) => T,
  message?: string,
): asserts value is T {
  if (!(value instanceof constructor)) {
    throw new Error(
      message ||
        `Expected value to be an instance of ${constructor.name}, but got ${value?.constructor?.name || typeof value}`,
    );
  }
}

/**
 * Asserts that an array contains a specific item
 */
export function assertContains<T>(array: T[], item: T, message?: string): void {
  if (!array.includes(item)) {
    throw new Error(message || `Expected array to contain item`);
  }
}

/**
 * Asserts that two arrays have the same elements (order doesn't matter)
 */
export function assertSameElements<T>(actual: T[], expected: T[], message?: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  if (actualSet.size !== expectedSet.size) {
    throw new Error(message || `Expected arrays to have same length: ${actualSet.size} vs ${expectedSet.size}`);
  }

  for (const item of expectedSet) {
    if (!actualSet.has(item)) {
      throw new Error(message || `Expected array to contain ${item}`);
    }
  }
}

/**
 * Asserts that a map has a specific key
 */
export function assertHasKey<K, V>(map: Map<K, V>, key: K, message?: string): void {
  if (!map.has(key)) {
    throw new Error(message || `Expected map to have key`);
  }
}

/**
 * Asserts that a promise rejects with a specific error
 */
export async function assertRejects(
  promise: Promise<any>,
  expectedError?: string | RegExp | (new (...args: any[]) => Error),
): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to reject, but it resolved');
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
 * Asserts that a promise resolves to a specific value
 */
export async function assertResolves<T>(promise: Promise<T>, expectedValue?: T): Promise<T> {
  const value = await promise;
  if (expectedValue !== undefined) {
    expect(value).toEqual(expectedValue);
  }
  return value;
}

/**
 * Creates a spy that captures console output
 */
export function spyConsole() {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];

  console.log = jest.fn((...args) => logs.push(args.join(' ')));
  console.warn = jest.fn((...args) => warns.push(args.join(' ')));
  console.error = jest.fn((...args) => errors.push(args.join(' ')));
  console.info = jest.fn((...args) => infos.push(args.join(' ')));

  return {
    logs,
    warns,
    errors,
    infos,
    restore: () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
    },
  };
}

/**
 * Suppresses console output during test execution
 */
export function suppressConsole() {
  const spy = spyConsole();
  return spy.restore;
}
