/** What a worker's `run()` receives. */
export interface WorkerRunContext {
  /** Aborted when the server shuts down or this process loses the worker's lease: end the run when it fires. */
  readonly signal: AbortSignal;
}

/**
 * A `@Worker` class: `run()` stays connected or keeps watching until `signal` is aborted. When it returns or throws
 * before that, the server runs it again after a wait.
 */
export interface WorkerInterface {
  run(context: WorkerRunContext): void | Promise<void>;
}
