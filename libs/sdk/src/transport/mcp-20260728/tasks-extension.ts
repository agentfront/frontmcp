/**
 * `io.modelcontextprotocol/tasks` extension — protocol 2026-07-28, SEP-2663.
 *
 * Tasks moved out of the core protocol into an official extension and were
 * redesigned:
 *
 * - The blocking `tasks/result` is gone; clients poll `tasks/get`.
 * - `tasks/list` is gone entirely.
 * - `tasks/update` is new — it feeds `inputResponses` to a task that has paused
 *   in `input_required`, which is how a long-running operation does
 *   human-in-the-loop without a second connection.
 * - Servers MAY return a task handle unsolicited; there is no per-request
 *   `params.task` opt-in any more. The gate is the CLIENT declaring the
 *   extension in its per-request capabilities.
 *
 * The wire shape also renames `ttl` → `ttlMs` and `pollInterval` → `pollIntervalMs`,
 * and a task-bearing response is discriminated by `resultType: "task"` rather
 * than by a `task` field on a normal result.
 */
import { type Scope } from '../../scope';
import { type TaskRecord } from '../../task/task.types';

/** Extension identifier, as declared in capabilities. */
export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';

/** RPCs this extension defines. */
export const TASKS_EXTENSION_METHODS = ['tasks/get', 'tasks/update', 'tasks/cancel'];

/** Terminal statuses — a task in one of these never changes again. */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];

/** True when the client declared support for the tasks extension on this request. */
export function clientSupportsTasks(clientCapabilities: Record<string, unknown>): boolean {
  const extensions = clientCapabilities['extensions'];
  if (!extensions || typeof extensions !== 'object') return false;
  return TASKS_EXTENSION_ID in (extensions as Record<string, unknown>);
}

/**
 * Project a stored task onto the 2026-07-28 `Task` wire shape.
 *
 * `result` / `error` only appear once the task is terminal, and `inputRequests`
 * only while it is paused waiting for the client — mirroring what the client is
 * actually allowed to act on at each point in the lifecycle.
 */
export function taskToWire20260728(record: TaskRecord): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    taskId: record.taskId,
    status: record.status,
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
    ttlMs: record.ttlMs,
  };

  if (record.pollIntervalMs !== undefined) wire['pollIntervalMs'] = record.pollIntervalMs;
  if (record.statusMessage !== undefined) wire['statusMessage'] = record.statusMessage;

  if (record.status === 'completed' && record.outcome?.kind === 'ok') {
    wire['result'] = record.outcome.data;
  }
  if (record.status === 'failed' && record.outcome?.kind === 'error') {
    wire['error'] = record.outcome.error;
  }
  if (record.status === 'input_required' && record.inputRequests) {
    wire['inputRequests'] = record.inputRequests;
  }

  return wire;
}

/**
 * Build the `CreateTaskResult` a server returns instead of an inline result.
 *
 * Discriminated by `resultType: "task"`, which is why the shared result
 * decorator must not overwrite it.
 */
export function buildCreateTaskResult(record: TaskRecord): Record<string, unknown> {
  return {
    resultType: 'task',
    task: taskToWire20260728(record),
  };
}

/**
 * Derive the owner key a task is stored under.
 *
 * 2026-07-28 has no protocol-level sessions, so a task must be keyed by
 * something that survives across independent requests — the authenticated
 * principal. Anonymous callers have no such identity: two unrelated users would
 * share one key and could read each other's task results, so tasks are refused
 * rather than silently pooled.
 */
export function resolveTaskOwner(principal: string): { ok: true; owner: string } | { ok: false; reason: string } {
  if (!principal || principal === 'anonymous') {
    return {
      ok: false,
      reason:
        'Tasks require an authenticated caller under protocol 2026-07-28: there are no protocol sessions, so an anonymous task could not be scoped to its creator',
    };
  }
  return { ok: true, owner: `principal:${principal}` };
}

export type TasksDispatchOutcome =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; status: number; error: { code: number; message: string; data?: unknown } };

export interface TasksDispatchOptions {
  scope: Scope;
  method: string;
  params: Record<string, unknown>;
  /** Owner key the task is stored under (see {@link resolveTaskOwner}). */
  owner: string;
  /** Re-runs a resumed task in the background. */
  resume: (record: TaskRecord) => Promise<void>;
}

const TASK_NOT_FOUND = { code: -32602, message: 'Task not found' };

/**
 * Serve `tasks/get`, `tasks/update` and `tasks/cancel`.
 *
 * These read and mutate the SAME store the 2025-era task methods use, so a
 * task created under either revision is visible to the other — only the wire
 * shape and the method set differ.
 */
export async function dispatchTasksMethod(options: TasksDispatchOptions): Promise<TasksDispatchOutcome> {
  const { scope, method, params, owner, resume } = options;

  const store = scope.taskStore;
  if (!store) {
    return { kind: 'error', status: 200, error: { code: -32603, message: 'Task store is not configured' } };
  }

  const taskId = typeof params['taskId'] === 'string' ? (params['taskId'] as string) : undefined;
  if (!taskId) {
    return { kind: 'error', status: 200, error: { code: -32602, message: 'taskId is required' } };
  }

  const record = await store.get(taskId, owner);
  // A task belonging to a different principal must be indistinguishable from
  // one that does not exist, or task ids become an existence oracle.
  if (!record) return { kind: 'error', status: 200, error: TASK_NOT_FOUND };

  if (method === 'tasks/get') {
    return { kind: 'result', result: taskToWire20260728(record) };
  }

  if (method === 'tasks/cancel') {
    if (TERMINAL_TASK_STATUSES.includes(record.status)) {
      // Cancellation is cooperative and a terminal task is already done; the
      // spec asks servers to acknowledge rather than error.
      return { kind: 'result', result: {} };
    }
    await store.update(taskId, owner, {
      status: 'cancelled',
      statusMessage: 'The task was cancelled by the client.',
    });
    await store.publishCancel(taskId, owner);
    return { kind: 'result', result: {} };
  }

  // tasks/update — feed answers to a task parked in `input_required`.
  const inputResponses = params['inputResponses'];
  if (!inputResponses || typeof inputResponses !== 'object') {
    return { kind: 'error', status: 200, error: { code: -32602, message: 'inputResponses is required' } };
  }

  if (record.status !== 'input_required') {
    return {
      kind: 'error',
      status: 200,
      error: { code: -32602, message: `Task ${taskId} is not awaiting input (status: ${record.status})` },
    };
  }

  // Merge rather than replace: a multi-step task accumulates answers across
  // several updates, and the spec says to ignore unknown or already-satisfied
  // keys rather than reject them.
  const merged = { ...(record.inputResponses ?? {}), ...(inputResponses as Record<string, Record<string, unknown>>) };
  const resumed = await store.update(taskId, owner, {
    status: 'working',
    statusMessage: 'The operation is now in progress.',
    inputResponses: merged,
    inputRequests: undefined,
  });

  // Do NOT await execution: `tasks/update` acknowledges immediately and the
  // task resumes in the background. Awaiting would turn the whole point of the
  // extension — non-blocking long-running work — back into a blocking call.
  if (resumed) {
    void resume(resumed).catch((error: unknown) => {
      scope.logger.error('mcp-20260728: resumed task failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return { kind: 'result', result: {} };
}
