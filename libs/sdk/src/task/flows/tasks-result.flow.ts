/**
 * tasks/result flow — blocks until the task reaches a terminal status, then
 * returns the underlying request's result verbatim.
 *
 * Per MCP 2025-11-25 §Result Retrieval:
 *  - For terminal tasks, MUST return exactly what the underlying request would
 *    have returned (a `CallToolResult` on success, or the original JSON-RPC
 *    error on failure).
 *  - For non-terminal tasks, MUST block until terminal. We use the store's
 *    pub/sub `subscribeTerminal` so cross-node unblocking works automatically.
 *  - The response MUST include `_meta['io.modelcontextprotocol/related-task']`
 *    with the `taskId` (unlike `tasks/get`/`list`/`cancel`).
 *
 * @module task/flows/tasks-result.flow
 */

import { z } from 'zod';

import { GetTaskPayloadRequestSchema, GetTaskPayloadResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import {
  InternalMcpError,
  InvalidInputError,
  InvalidMethodError,
  TaskNotFoundError,
  TaskStoreNotInitializedError,
} from '../../errors';
import { isTerminal, RELATED_TASK_META_KEY, type TaskRecord } from '../task.types';

const inputSchema = z.object({
  request: GetTaskPayloadRequestSchema,
  ctx: z.any(),
});

// The response shape is dynamic — per spec, it matches the underlying request
// type (e.g. CallToolResult for tools/call). We allow any object and attach
// the required related-task _meta.
const outputSchema = GetTaskPayloadResultSchema;

const stateSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  authInfo: z.any() as z.ZodType<AuthInfo>,
});

const plan = {
  pre: ['parseInput'],
  execute: ['awaitTerminal'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tasks:result': FlowRunOptions<
      TasksResultFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tasks:result' as const;
const { Stage } = FlowHooksOf<'tasks:result'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class TasksResultFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('TasksResultFlow');

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
      throw new InvalidInputError('Invalid tasks/result request', e instanceof z.ZodError ? e.issues : undefined);
    }
    if (method !== 'tasks/result') {
      throw new InvalidMethodError(method, 'tasks/result');
    }
    const authInfo = ctx?.authInfo;
    if (!authInfo?.sessionId) {
      throw new InternalMcpError('Session ID missing in authorized flow', 'AUTH_INFO_MISSING');
    }
    this.state.set({ taskId: params.taskId, sessionId: authInfo.sessionId, authInfo });
  }

  @Stage('awaitTerminal')
  async awaitTerminal() {
    const store = this.scope.taskStore;
    if (!store) throw new TaskStoreNotInitializedError();
    const { taskId, sessionId } = this.state.required;

    const initial = await store.get(taskId, sessionId);
    if (!initial) throw new TaskNotFoundError(taskId);

    const finalRecord = isTerminal(initial.status) ? initial : await this.waitForTerminal(taskId, sessionId, store);
    if (!finalRecord) throw new TaskNotFoundError(taskId);

    this.respondWithOutcome(finalRecord);
  }

  /**
   * Block until the task reaches a terminal state.
   *
   * Two wake-up paths:
   *  1. `subscribeTerminal` — instant for backends whose pub/sub reaches this
   *     process (memory, Redis/Upstash, SQLite within the same process).
   *  2. Periodic `store.get` polling — the only path that works for the
   *     SQLite backend when the caller and the runner live in different
   *     processes (CLI runner + future stdio invocation). Without this, those
   *     callers would block forever since the child's EventEmitter never
   *     reaches the parent.
   */
  private async waitForTerminal(
    taskId: string,
    sessionId: string,
    store: NonNullable<typeof this.scope.taskStore>,
  ): Promise<TaskRecord | null> {
    return new Promise<TaskRecord | null>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => Promise<void>) | undefined;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;

      const finalize = async (result: TaskRecord | null, err?: unknown) => {
        if (settled) return;
        settled = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (unsubscribe) {
          try {
            await unsubscribe();
          } catch {
            // best effort
          }
        }
        if (err) reject(err);
        else resolve(result);
      };

      // Cross-process safety net: tick at the task's suggested poll interval
      // (falling back to 500ms) so SQLite-backed waiters don't hang when the
      // terminal transition happened in another process.
      const poll = async () => {
        if (settled) return;
        try {
          const latest = await store.get(taskId, sessionId);
          if (!latest) return void finalize(null);
          if (isTerminal(latest.status)) return void finalize(latest);
        } catch (err) {
          return void finalize(null, err);
        }
        pollTimer = setTimeout(() => void poll(), this.pollDelayMs());
      };

      store
        .subscribeTerminal(taskId, sessionId, (record) => {
          if (isTerminal(record.status)) {
            void finalize(record);
          }
        })
        .then(async (unsub) => {
          unsubscribe = unsub;
          // Re-check after subscribing to avoid a race where the task went
          // terminal between our initial `get` and `subscribeTerminal`.
          const latest = await store.get(taskId, sessionId);
          if (!latest) {
            return void finalize(null);
          }
          if (isTerminal(latest.status)) {
            return void finalize(latest);
          }
          // Arm the polling fallback for same-backend-different-process hosts.
          pollTimer = setTimeout(() => void poll(), this.pollDelayMs(latest.pollIntervalMs));
        })
        .catch((err) => void finalize(null, err));
    });
  }

  private pollDelayMs(hint?: number): number {
    const min = 200;
    const max = 5_000;
    if (typeof hint === 'number' && hint > 0) return Math.max(min, Math.min(hint, max));
    return 500;
  }

  private respondWithOutcome(record: TaskRecord): void {
    if (!record.outcome) {
      // Should never happen for a terminal record. Emit a generic JSON-RPC error.
      throw new InternalMcpError('Terminal task has no outcome', 'TASK_MISSING_OUTCOME');
    }
    if (record.outcome.kind === 'error') {
      // The flow framework will convert thrown McpErrors into JSON-RPC errors.
      // Preserve the original code & message exactly per spec.
      const { code, message, data } = record.outcome.error;
      const err = new JsonRpcReplayError(code, message, data, record.taskId);
      throw err;
    }
    // Success: attach related-task meta to the original CallToolResult per spec.
    const payload = { ...record.outcome.data } as Record<string, unknown>;
    const existingMeta = (payload['_meta'] as Record<string, unknown> | undefined) ?? {};
    payload['_meta'] = { ...existingMeta, [RELATED_TASK_META_KEY]: { taskId: record.taskId } };
    // Bypass zod strict parsing in respond() — payload matches the spec's
    // dynamic result type (CallToolResult), which passes the loose payload schema.
    this.respond(payload as unknown as z.infer<typeof outputSchema>);
  }
}

/**
 * Thrown from `tasks:result` when the underlying request terminated in error.
 * The handler converts this back into the exact JSON-RPC error per spec.
 */
export class JsonRpcReplayError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data: unknown,
    public readonly taskId: string,
  ) {
    super(message);
    this.name = 'JsonRpcReplayError';
  }
  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    const out: { code: number; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) out.data = this.data;
    return out;
  }
}
