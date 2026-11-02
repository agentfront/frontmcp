import { InternalMcpError, PublicMcpError } from './mcp.error';

/** Offloaded work ran past its budget: its worker was terminated. */
export class OffloadBudgetExceededError extends PublicMcpError {
  readonly target: string;
  readonly budgetMs: number;

  constructor(target: string, budgetMs: number) {
    super(`Offloaded "${target}" ran past its ${budgetMs} ms budget and was stopped`, 'OFFLOAD_BUDGET_EXCEEDED', 504);
    this.target = target;
    this.budgetMs = budgetMs;
  }
}

/** Offloaded work was stopped before it finished: its call was cancelled, or the server shut down. */
export class OffloadAbortedError extends PublicMcpError {
  readonly target: string;

  constructor(target: string, reason: 'cancelled' | 'shutdown') {
    const why = reason === 'cancelled' ? 'its call was cancelled' : 'the server is shutting down';
    super(`Offloaded "${target}" was stopped: ${why}`, 'OFFLOAD_ABORTED', 499);
    this.target = target;
  }
}

/** `offload()` and `worker: true` need Node.js `worker_threads`. */
export class OffloadUnsupportedRuntimeError extends InternalMcpError {
  readonly runtime: string;

  constructor(runtime: string) {
    super(
      `Offloading work needs Node.js worker_threads, and this server runs on "${runtime}"`,
      'OFFLOAD_UNSUPPORTED_RUNTIME',
    );
    this.runtime = runtime;
  }
}

/** An `offload()` call or a `worker: true` resource is not one the pool can run. */
export class InvalidOffloadCallError extends InternalMcpError {
  constructor(detail: string) {
    super(`Invalid offload: ${detail}`, 'INVALID_OFFLOAD_CALL');
  }
}

/** What crosses into or out of a worker must be structured-cloneable. */
export class OffloadNotCloneableError extends InternalMcpError {
  readonly target: string;

  constructor(target: string, what: 'arguments' | 'result', cause: string) {
    super(
      `Offloaded "${target}": its ${what} cannot be structured-cloned (${cause}). Pass plain data: no functions, symbols or class instances with behaviour.`,
      'OFFLOAD_NOT_CLONEABLE',
    );
    this.target = target;
  }
}

/** The worker running offloaded work crashed or exited before it answered. */
export class OffloadWorkerError extends InternalMcpError {
  readonly target: string;

  constructor(target: string, detail: string) {
    super(`The worker running "${target}" failed: ${detail}`, 'OFFLOAD_WORKER_FAILED');
    this.target = target;
  }
}
