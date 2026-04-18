/**
 * Runner abstraction — picks how a task-augmented `tools/call` actually gets
 * executed. Long-lived Node servers use the in-process runner (a microtask
 * dispatch). CLI hosts spawn a detached child process so the work survives
 * the short-lived parent.
 *
 * @module task/helpers/task-runner.types
 */

import type { TaskRecord } from '../task.types';

export interface SpawnContext {
  /** Raw request params after stripping the `task` field, passed to the tool. */
  cleanedRequestParams: Record<string, unknown>;
  /** Original request handler context (carries authInfo etc.). */
  ctx: unknown;
}

export interface TaskRunner {
  readonly kind: 'in-process' | 'cli';

  /**
   * Start executing `record`. Implementations are fire-and-forget — the promise
   * resolves once execution has been *scheduled*, not completed. A successful
   * resolve does NOT mean the task is done; state transitions are persisted via
   * the TaskStore.
   */
  run(record: TaskRecord, context: SpawnContext): Promise<void>;

  /**
   * Attempt to cancel execution of a record. Called from `tasks/cancel` after
   * the store transition to `cancelled` has already been written. Implementations
   * should be idempotent and tolerate absent executors.
   */
  cancel(record: TaskRecord): Promise<void>;
}
