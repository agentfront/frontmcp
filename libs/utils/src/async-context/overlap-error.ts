/**
 * Thrown by the browser `AsyncLocalStorage` when two concurrent runs of one storage in the same
 * request overlapped. Without a runtime-provided async context the storage cannot tell which of them
 * a later read belongs to, so it refuses to answer instead of returning the other run's value.
 */
export class AsyncContextOverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsyncContextOverlapError';
  }
}
