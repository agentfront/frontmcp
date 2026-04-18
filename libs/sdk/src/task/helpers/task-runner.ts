/**
 * Task runner — executes a `tools/call` request in the background and records
 * its terminal outcome.
 *
 * Called synchronously (fire-and-forget) from the task-creation path in the
 * existing `tools:call-tool` flow. The outer HTTP request will already have
 * returned the `CreateTaskResult` by the time this resumes.
 *
 * Runtime approach: we re-dispatch the underlying `tools/call` request through
 * `scope.runFlowForOutput('tools:call-tool', ...)` with the `task` field
 * stripped so the flow executes the tool normally. Any result or thrown error
 * is captured into a TaskOutcome and written to the store as a terminal state.
 *
 * Cross-node cancel: we subscribe to the cancel channel for the duration of
 * execution. If a cancel is signalled, the AbortController fires, which the
 * tool is expected to observe through the standard execution context.
 *
 * @module task/helpers/task-runner
 */

import type { CallToolResult } from '@frontmcp/protocol';

import type { FrontMcpLogger } from '../../common';
import type { TaskStore } from '../store';
import type { TaskRegistry } from '../task.registry';
import { isTerminal, type TaskJsonRpcError, type TaskRecord } from '../task.types';
import type { TaskNotifier } from './task-notifier';

/** Narrow interface over scope to avoid circular type import. */
export interface TaskRunnerScope {
  runFlowForOutput<TInput = unknown, TOutput = unknown>(name: 'tools:call-tool', input: TInput): Promise<TOutput>;
}

export interface RunTaskParams {
  /** Persisted record (already stored in status `working`). */
  record: TaskRecord;
  /** Raw request params AFTER removing the `task` field, to pass to the flow. */
  cleanedRequestParams: Record<string, unknown>;
  /** The original request handler context (carries authInfo etc.). */
  ctx: unknown;
  scope: TaskRunnerScope;
  store: TaskStore;
  registry: TaskRegistry;
  notifier: TaskNotifier;
  logger?: FrontMcpLogger;
}

/**
 * Schedule background execution and return immediately. The returned Promise
 * resolves once the task reaches a terminal state — primarily useful in tests.
 */
export function runTaskInBackground(params: RunTaskParams): Promise<void> {
  // Use microtask dispatch so the outer flow can finish responding with
  // CreateTaskResult before background work kicks off.
  return Promise.resolve().then(() => executeTask(params));
}

async function executeTask(params: RunTaskParams): Promise<void> {
  const { record, cleanedRequestParams, ctx, scope, store, registry, notifier, logger } = params;
  const { taskId, sessionId } = record;

  // Bootstrap runs inside the try/finally guard so a failing subscribeCancel()
  // still releases the registry slot and we can record a terminal failure.
  const controller = registry.trackRunning(taskId);
  let unsubscribeCancel: (() => Promise<void>) | undefined;

  // Preserve the original context INSTANCE (not a plain-object spread) so
  // prototype-backed behavior — e.g. plugins that attach `this.remember` to
  // ExecutionContextBase — remains observable in background runs. We mutate
  // two new fields onto it; they're read-only from the tool's POV.
  const taskCtx = ctx as { signal?: AbortSignal; taskId?: string };
  taskCtx.signal = controller.signal;
  taskCtx.taskId = taskId;

  try {
    unsubscribeCancel = await store.subscribeCancel(taskId, sessionId, () => {
      if (!controller.signal.aborted) {
        controller.abort('tasks/cancel');
      }
    });

    // Re-dispatch the underlying tools/call through the same flow, minus the
    // `task` param so we execute the tool normally this time.
    const innerRequest = {
      method: 'tools/call' as const,
      params: cleanedRequestParams,
    };

    let outcomeOk: CallToolResult | undefined;
    let outcomeErr: TaskJsonRpcError | undefined;
    try {
      outcomeOk = await scope.runFlowForOutput<unknown, CallToolResult>('tools:call-tool', {
        request: innerRequest,
        ctx: taskCtx,
      });
    } catch (err) {
      outcomeErr = toJsonRpcError(err);
    }

    // Check the currently-stored status first: if something else (e.g. a
    // `tasks/cancel` on another node) already wrote a terminal state, leave it
    // alone. This matches spec §Task Cancellation: "Once a task is cancelled,
    // it MUST remain in cancelled status even if execution continues."
    const current = await store.get(taskId, sessionId);
    if (!current) {
      logger?.debug('[task-runner] record gone before terminal write', { taskId });
      return;
    }
    if (isTerminal(current.status)) {
      // Publish anyway so any waiter on tasks/result gets unblocked by the
      // already-terminal record.
      await store.publishTerminal(current);
      notifier.sendStatus(current);
      return;
    }

    const isErrorResult = outcomeErr !== undefined || outcomeOk?.isError === true;
    const finalStatus = controller.signal.aborted ? 'cancelled' : isErrorResult ? 'failed' : 'completed';
    const statusMessage = controller.signal.aborted
      ? 'The task was cancelled before completion.'
      : (outcomeErr?.message ?? (outcomeOk?.isError === true ? 'Tool execution returned isError: true' : undefined));

    const updated = await store.update(taskId, sessionId, {
      status: finalStatus,
      statusMessage,
      outcome: outcomeErr
        ? { kind: 'error', error: outcomeErr }
        : outcomeOk
          ? { kind: 'ok', data: outcomeOk }
          : undefined,
    });

    if (updated) {
      await store.publishTerminal(updated);
      notifier.sendStatus(updated);
    }
  } catch (err) {
    // Any failure below the inner try/catch (store.get/update/publishTerminal,
    // subscribeCancel bootstrap, notifier) lands here. Log, then best-effort
    // mark the task as failed so a client polling tasks/get doesn't spin
    // forever. Uncaught rejections would otherwise escape into the Node event
    // loop since this runs fire-and-forget.
    logger?.error('[task-runner] unhandled error in task lifecycle', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (!controller.signal.aborted) controller.abort('task-runner error');
    try {
      const failed = await store.update(taskId, sessionId, {
        status: 'failed',
        statusMessage: err instanceof Error ? err.message : 'Task runner failed',
        outcome: { kind: 'error', error: toJsonRpcError(err) },
      });
      if (failed) {
        try {
          await store.publishTerminal(failed);
        } catch {
          // best effort — publish failure is already logged by the store
        }
        notifier.sendStatus(failed);
      }
    } catch {
      // If even the bookkeeping write fails, there's nothing more we can do.
      // The orphan-detection path on the next tasks/get will eventually mark
      // the record failed when the PID probe shows us as gone.
    }
  } finally {
    registry.untrack(taskId);
    if (unsubscribeCancel) {
      try {
        await unsubscribeCancel();
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Map any thrown error into a JSON-RPC error shape suitable for the spec-mandated
 * `tasks/result` replay behaviour. We reuse the SDK's `formatMcpErrorResponse`
 * indirectly by pulling `mcpErrorCode`/`toJsonRpcError` when available.
 */
function toJsonRpcError(err: unknown): TaskJsonRpcError {
  if (err && typeof err === 'object') {
    const anyErr = err as {
      toJsonRpcError?: () => { code: number; message: string; data?: unknown };
      mcpErrorCode?: number;
      message?: string;
      code?: number;
    };
    if (typeof anyErr.toJsonRpcError === 'function') {
      return anyErr.toJsonRpcError();
    }
    if (typeof anyErr.mcpErrorCode === 'number') {
      return {
        code: anyErr.mcpErrorCode,
        message: typeof anyErr.message === 'string' ? anyErr.message : 'Task execution error',
      };
    }
    if (typeof anyErr.code === 'number' && typeof anyErr.message === 'string') {
      return { code: anyErr.code, message: anyErr.message };
    }
  }
  return {
    code: -32603,
    message: err instanceof Error ? err.message : 'Internal error',
  };
}
