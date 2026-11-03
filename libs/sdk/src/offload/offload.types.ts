import type { FrontMcpLogger } from '../common/interfaces/logger.interface';

/** The function `this.offload()` runs in a worker thread: a module and one of its exports. */
export interface OffloadModuleRef {
  /**
   * The module, as an absolute path or a `file:` URL: `new URL('./parse.js', import.meta.url)` in an ES module,
   * `path.join(__dirname, 'parse.js')` in CommonJS. A relative path or a package name is refused.
   */
  module: string | URL;
  /**
   * The exported function to call with the arguments.
   * @default 'default'
   */
  export?: string;
}

export interface OffloadCallOptions {
  /**
   * How long the function may run, from the moment it starts in its worker. Past it the worker is terminated and the
   * call rejects with `OffloadBudgetExceededError`. Waiting for a free worker does not count, and loading the module in a
   * fresh worker is bounded by the larger of this and `offload.budgetMs`.
   * @default `offload.budgetMs` of the server, 30000
   */
  budgetMs?: number;
  /**
   * Stops the work: its worker is terminated and the call rejects with `OffloadAbortedError`.
   * @default the context's `this.signal`
   */
  signal?: AbortSignal;
}

/** A function `this.offload()` can run: its arguments and result cross the worker boundary by structured clone. */
export type OffloadFunction = (...args: never[]) => unknown;

/** @internal What the pool runs. */
export type OffloadTask =
  | { kind: 'function'; moduleRef: OffloadModuleRef; args: readonly unknown[] }
  | { kind: 'resource'; file: string; key: string; name: string; uri: string; params: Record<string, string> }
  | { kind: 'job'; file: string; key: string; name: string; input: unknown; attempt: number };

/** @internal How the pool runs it. */
export interface OffloadRun {
  /** What the errors and the budget warning name the work by. */
  label: string;
  budgetMs?: number;
  signal?: AbortSignal;
  /** Receives the budget warning and the log lines a worker-side resource or job writes. */
  logger: FrontMcpLogger;
  /** Receives the progress a worker-side job reports. */
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
}
