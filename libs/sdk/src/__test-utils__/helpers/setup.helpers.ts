/// <reference types="jest" />
/**
 * Helper utilities for test setup and teardown
 */

import 'reflect-metadata';

/**
 * Creates a clean test environment with automatic cleanup
 */
export function createTestEnvironment() {
  const cleanupFns: Array<() => void | Promise<void>> = [];

  return {
    /**
     * Registers a cleanup function to be called after the test
     */
    onCleanup(fn: () => void | Promise<void>): void {
      cleanupFns.push(fn);
    },

    /**
     * Cleans up all registered resources
     */
    async cleanup(): Promise<void> {
      for (const fn of cleanupFns.reverse()) {
        await fn();
      }
      cleanupFns.length = 0;
    },
  };
}

/**
 * Wraps a test function with automatic environment setup and cleanup
 */
export function withTestEnvironment<T extends any[]>(
  testFn: (env: ReturnType<typeof createTestEnvironment>, ...args: T) => Promise<void> | void
) {
  return async (...args: T) => {
    const env = createTestEnvironment();
    try {
      await testFn(env, ...args);
    } finally {
      await env.cleanup();
    }
  };
}

/**
 * Creates a mock timer for testing time-based operations
 */
export function useFakeTimers() {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  return {
    advance: (ms: number) => jest.advanceTimersByTime(ms),
    runAll: () => jest.runAllTimers(),
    runPending: () => jest.runOnlyPendingTimers(),
  };
}

/**
 * Creates a test-specific logger that can be inspected
 */
export function createTestLogger() {
  const logs: Array<{ level: string; message: string; data?: any }> = [];

  return {
    log: (message: string, data?: any) => logs.push({ level: 'log', message, data }),
    warn: (message: string, data?: any) => logs.push({ level: 'warn', message, data }),
    error: (message: string, data?: any) => logs.push({ level: 'error', message, data }),
    info: (message: string, data?: any) => logs.push({ level: 'info', message, data }),
    debug: (message: string, data?: any) => logs.push({ level: 'debug', message, data }),
    getLogs: () => logs,
    clear: () => (logs.length = 0),
    hasLog: (level: string, message: string) =>
      logs.some((log) => log.level === level && log.message.includes(message)),
  };
}

/**
 * Ensures reflect-metadata is loaded for decorator tests
 */
export function setupReflectMetadata() {
  beforeAll(() => {
    // Ensure reflect-metadata is loaded
    if (typeof Reflect === 'undefined' || !Reflect.getMetadata) {
      throw new Error('reflect-metadata is not loaded');
    }
  });
}

/**
 * Clears all mocks between tests
 */
export function setupMockClearing() {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
}
