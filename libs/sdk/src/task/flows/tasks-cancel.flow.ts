/**
 * tasks/cancel flow — transitions a task to `cancelled` status and signals any
 * in-flight executor (on this node or a different one) to abort.
 *
 * Per MCP 2025-11-25 §Task Cancellation:
 *  - Reject if the task is already terminal with `-32602` (InvalidParams).
 *  - On success, MUST transition the task to `cancelled` before responding.
 *  - Receivers MAY delete the task at their discretion afterwards.
 *
 * @module task/flows/tasks-cancel.flow
 */

import { z } from '@frontmcp/lazy-zod';
import { CancelTaskRequestSchema, CancelTaskResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import {
  InternalMcpError,
  InvalidInputError,
  InvalidMethodError,
  TaskAlreadyTerminalError,
  TaskNotFoundError,
  TaskStoreNotInitializedError,
} from '../../errors';
import { isTerminal, toWireShape } from '../task.types';

const inputSchema = z.object({
  request: CancelTaskRequestSchema,
  ctx: z.any(),
});

const outputSchema = CancelTaskResultSchema;

const stateSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  authInfo: z.any() as z.ZodType<AuthInfo>,
});

const plan = {
  pre: ['parseInput'],
  execute: ['cancelAndRespond'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tasks:cancel': FlowRunOptions<
      TasksCancelFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tasks:cancel' as const;
const { Stage } = FlowHooksOf<'tasks:cancel'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class TasksCancelFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('TasksCancelFlow');

  @Stage('parseInput')
  async parseInput() {
    let method!: string;
    let params: { taskId: string };
    let ctx: { authInfo?: AuthInfo } | undefined;
    try {
      const parsed = inputSchema.parse(this.rawInput);
      method = parsed.request.method;
      params = parsed.request.params;
      ctx = parsed.ctx as { authInfo?: AuthInfo } | undefined;
    } catch (e) {
      throw new InvalidInputError('Invalid tasks/cancel request', e instanceof z.ZodError ? e.issues : undefined);
    }
    if (method !== 'tasks/cancel') {
      throw new InvalidMethodError(method, 'tasks/cancel');
    }
    const authInfo = ctx?.authInfo;
    if (!authInfo?.sessionId) {
      throw new InternalMcpError('Session ID missing in authorized flow', 'AUTH_INFO_MISSING');
    }
    this.state.set({ taskId: params.taskId, sessionId: authInfo.sessionId, authInfo });
  }

  @Stage('cancelAndRespond')
  async cancelAndRespond() {
    const store = this.scope.taskStore;
    const registry = this.scope.tasks;
    if (!store || !registry) throw new TaskStoreNotInitializedError();
    const { taskId, sessionId } = this.state.required;

    const existing = await store.get(taskId, sessionId);
    if (!existing) throw new TaskNotFoundError(taskId);
    if (isTerminal(existing.status)) throw new TaskAlreadyTerminalError(existing.status);

    // Transition to cancelled FIRST, then signal executors.
    const updated = await store.update(taskId, sessionId, {
      status: 'cancelled',
      statusMessage: 'The task was cancelled by request.',
    });
    if (!updated) throw new TaskNotFoundError(taskId);

    // Delegate to the active runner so it can signal its executor (in-process
    // AbortController for Node servers; SIGTERM to the worker PID for CLI).
    // Fall back to the registry abort for robustness.
    if (registry.runner) {
      try {
        await registry.runner.cancel(updated);
      } catch (err) {
        this.logger.warn('runner.cancel failed', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      registry.abort(taskId, 'tasks/cancel');
    }
    // Broadcast to any other node that might be running it.
    try {
      await store.publishCancel(taskId, sessionId);
    } catch (err) {
      this.logger.warn('publishCancel failed', { taskId, error: err instanceof Error ? err.message : String(err) });
    }
    // Unblock tasks/result waiters with the cancelled state.
    try {
      await store.publishTerminal(updated);
    } catch (err) {
      this.logger.warn('publishTerminal failed', { taskId, error: err instanceof Error ? err.message : String(err) });
    }
    // Notify client via notifications/tasks/status (best-effort).
    this.scope.notifications.sendNotificationToSession(
      sessionId,
      'notifications/tasks/status',
      toWireShape(updated) as unknown as Record<string, unknown>,
    );

    this.respond(toWireShape(updated));
  }
}
