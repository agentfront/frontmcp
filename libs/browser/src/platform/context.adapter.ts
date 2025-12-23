// file: libs/browser/src/platform/context.adapter.ts
/**
 * Browser implementation of PlatformContextStorage.
 *
 * In browser environments, we don't need AsyncLocalStorage because:
 * 1. Browser JavaScript is single-threaded
 * 2. Async operations don't require context propagation like in Node.js
 * 3. We can use simple variable scoping for context management
 */

import type { PlatformContextStorage } from '@frontmcp/sdk/core';

/**
 * Browser context storage using simple scoped variables.
 *
 * This is a simplified implementation for browser environments where
 * we don't need the complex context propagation that AsyncLocalStorage
 * provides in Node.js.
 *
 * @example
 * ```typescript
 * import { BrowserContextStorage } from '@frontmcp/browser';
 *
 * interface RequestContext {
 *   requestId: string;
 *   userId: string;
 * }
 *
 * const contextStorage = new BrowserContextStorage<RequestContext>();
 *
 * contextStorage.run({ requestId: '123', userId: 'user1' }, () => {
 *   const ctx = contextStorage.getStore();
 *   console.log(ctx?.requestId); // '123'
 * });
 * ```
 */
export class BrowserContextStorage<T> implements PlatformContextStorage<T> {
  private currentContext: T | undefined;
  private contextStack: T[] = [];

  /**
   * Run a function within a context.
   *
   * The context is set for the duration of the function execution
   * and then restored to the previous context (if any).
   */
  run<R>(context: T, fn: () => R): R {
    // Push current context to stack
    if (this.currentContext !== undefined) {
      this.contextStack.push(this.currentContext);
    }

    // Set new context
    this.currentContext = context;

    try {
      return fn();
    } finally {
      // Restore previous context
      this.currentContext = this.contextStack.pop();
    }
  }

  /**
   * Get the current context value.
   * Returns undefined if not in a context.
   */
  getStore(): T | undefined {
    return this.currentContext;
  }

  /**
   * Check if currently running within a context.
   */
  hasContext(): boolean {
    return this.currentContext !== undefined;
  }

  /**
   * Get the current context depth (for debugging).
   */
  getDepth(): number {
    return this.contextStack.length + (this.currentContext !== undefined ? 1 : 0);
  }

  /**
   * Clear all contexts (mainly for testing).
   */
  clear(): void {
    this.currentContext = undefined;
    this.contextStack = [];
  }
}

/**
 * Async-aware browser context storage.
 *
 * This variant handles async functions properly by tracking
 * the async operation and maintaining context across await points.
 *
 * Note: In browser environments, this is mostly for API compatibility
 * with Node.js patterns. The browser's event loop doesn't require
 * the same context propagation that AsyncLocalStorage provides.
 *
 * @example
 * ```typescript
 * const asyncStorage = new AsyncBrowserContextStorage<Context>();
 *
 * await asyncStorage.run({ id: '123' }, async () => {
 *   await someAsyncOperation();
 *   const ctx = asyncStorage.getStore(); // Still accessible
 * });
 * ```
 */
export class AsyncBrowserContextStorage<T> implements PlatformContextStorage<T> {
  private currentContext: T | undefined;
  private contextStack: T[] = [];

  /**
   * Run a function within a context.
   * Handles both sync and async functions.
   */
  run<R>(context: T, fn: () => R): R {
    // Push current context to stack
    if (this.currentContext !== undefined) {
      this.contextStack.push(this.currentContext);
    }

    // Set new context
    this.currentContext = context;

    try {
      const result = fn();

      // Handle async functions
      if (result instanceof Promise) {
        return result.finally(() => {
          this.currentContext = this.contextStack.pop();
        }) as R;
      }

      return result;
    } finally {
      // For sync functions, restore context immediately
      // For async functions, this is handled in the finally above
      if (!(fn() instanceof Promise)) {
        this.currentContext = this.contextStack.pop();
      }
    }
  }

  /**
   * Get the current context value.
   */
  getStore(): T | undefined {
    return this.currentContext;
  }

  /**
   * Check if currently running within a context.
   */
  hasContext(): boolean {
    return this.currentContext !== undefined;
  }
}

/**
 * Create a browser context storage instance.
 */
export function createBrowserContextStorage<T>(): BrowserContextStorage<T> {
  return new BrowserContextStorage<T>();
}
