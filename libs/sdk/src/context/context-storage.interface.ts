/**
 * Context Storage Interface
 *
 * Abstraction over AsyncLocalStorage (Node.js) and stack-based storage (browser).
 * Both implementations provide the same API for running callbacks with context
 * and retrieving the current context.
 */

/**
 * Platform-agnostic context storage interface.
 *
 * In Node.js, this is backed by AsyncLocalStorage for concurrent-safe context propagation.
 * In browser, this is backed by a synchronous stack (single-threaded, no concurrency).
 */
export interface IContextStorage<T> {
  /**
   * Run a callback with the given context value.
   * The context is available via `getStore()` within the callback and any
   * nested async operations it spawns.
   */
  run<R>(store: T, fn: () => R): R;

  /**
   * Get the current context value, or undefined if not inside a `run()` call.
   */
  getStore(): T | undefined;
}
