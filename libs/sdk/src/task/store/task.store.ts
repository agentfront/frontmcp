/**
 * TaskStore interface — abstraction over persistent state for MCP background tasks.
 *
 * Mirrors the elicitation store design: reads/writes + pub/sub for cross-node
 * result unblocking and cancel signaling.
 *
 * @module task/store/task.store
 */

import type { TaskRecord } from '../task.types';

/** Callback invoked when a task reaches a terminal status. */
export type TaskTerminalCallback = (record: TaskRecord) => void;

/** Callback invoked when a task has been asked to cancel. */
export type TaskCancelCallback = () => void;

/** Unsubscribe handle returned by subscribe* methods. */
export type TaskUnsubscribe = () => Promise<void>;

/** Result of a paginated list operation. */
export interface TaskListPage {
  tasks: TaskRecord[];
  nextCursor?: string;
}

export interface TaskStore {
  /**
   * Persist a newly-created task record. The store SHOULD honor `expiresAt`
   * as TTL for automatic cleanup. Must fail if a record with the same
   * `taskId` already exists (taskId collisions are a bug upstream).
   */
  create(record: TaskRecord): Promise<void>;

  /**
   * Fetch a task record. Returns `null` if:
   *  - the task does not exist
   *  - the task has expired
   *  - `sessionId` does not match the record's session (hard auth binding)
   */
  get(taskId: string, sessionId: string): Promise<TaskRecord | null>;

  /**
   * Apply a partial patch. Returns the updated record, or `null` if the task
   * no longer exists / belongs to a different session. Implementations should
   * treat this as a read-modify-write (no external CAS requirement).
   */
  update(taskId: string, sessionId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null>;

  /**
   * Delete a task record. No-op if not found.
   */
  delete(taskId: string, sessionId: string): Promise<void>;

  /**
   * List tasks owned by `sessionId`, paginated.
   * Cursor format is opaque to callers; implementations define their own.
   */
  list(sessionId: string, opts?: { cursor?: string; pageSize?: number }): Promise<TaskListPage>;

  /**
   * Subscribe for a one-shot terminal notification on the given task.
   * Called once the store observes a terminal status.
   */
  subscribeTerminal(taskId: string, sessionId: string, cb: TaskTerminalCallback): Promise<TaskUnsubscribe>;

  /**
   * Publish a terminal state change. MUST be called after the backing record
   * has been updated to a terminal status.
   */
  publishTerminal(record: TaskRecord): Promise<void>;

  /**
   * Subscribe for cancellation signals. Used by the node running the task to
   * react to a `tasks/cancel` that arrived at a different node.
   */
  subscribeCancel(taskId: string, sessionId: string, cb: TaskCancelCallback): Promise<TaskUnsubscribe>;

  /**
   * Broadcast a cancellation signal. The authoritative state transition to
   * `cancelled` still happens in the flow layer via `update()`.
   */
  publishCancel(taskId: string, sessionId: string): Promise<void>;

  /** Optional teardown hook called during server shutdown. */
  destroy?(): Promise<void>;
}
