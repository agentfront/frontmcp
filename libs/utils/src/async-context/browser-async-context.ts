/**
 * Browser polyfill for AsyncLocalStorage.
 *
 * Uses a simple stack-based approach, which is safe in single-threaded
 * browser environments. Does not support `enterWith()` or `disable()`
 * (neither is used in the FrontMCP codebase).
 */
export class AsyncLocalStorage<T> {
  private stack: (T | undefined)[] = [];

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    this.stack.push(store);
    try {
      const result = callback(...args);
      if (result instanceof Promise) {
        return result.finally(() => this.stack.pop()) as R;
      }
      this.stack.pop();
      return result;
    } catch (err) {
      this.stack.pop();
      throw err;
    }
  }

  getStore(): T | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }
}
