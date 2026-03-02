/**
 * Browser Context Storage
 *
 * Stack-based context storage for browser environments.
 * Since browsers are single-threaded, a synchronous stack is sufficient
 * for context propagation through async call chains.
 *
 * Limitations:
 * - Works for linear async chains (await-based)
 * - Detached promises that outlive their parent context scope will lose context
 * - No true concurrency isolation (unlike Node.js AsyncLocalStorage)
 */

import type { IContextStorage } from './context-storage.interface';

/**
 * Stack-based context storage for browser environments.
 *
 * Push context on `run()` entry, pop on exit (with `finally` for async safety).
 */
export class BrowserContextStorage<T> implements IContextStorage<T> {
  private readonly stack: T[] = [];

  run<R>(store: T, fn: () => R): R {
    this.stack.push(store);
    try {
      const result = fn();
      // Handle async functions: pop after the promise settles
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            this.stack.pop();
            return value;
          },
          (error) => {
            this.stack.pop();
            throw error;
          },
        ) as R;
      }
      // Sync: pop immediately
      this.stack.pop();
      return result;
    } catch (error) {
      this.stack.pop();
      throw error;
    }
  }

  getStore(): T | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }
}
