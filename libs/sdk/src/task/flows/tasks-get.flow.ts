/**
 * tasks/get flow — returns the current state snapshot of a task.
 *
 * Per MCP 2025-11-25 §Getting Tasks. Non-blocking: returns the record as-is,
 * whether `working`, `input_required`, or terminal.
 *
 * @module task/flows/tasks-get.flow
 */

import { z } from 'zod';

import { GetTaskRequestSchema, GetTaskResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import {
  InternalMcpError,
  InvalidInputError,
  InvalidMethodError,
  TaskNotFoundError,
  TaskStoreNotInitializedError,
} from '../../errors';
import { toWireShape } from '../task.types';

const inputSchema = z.object({
  request: GetTaskRequestSchema,
  ctx: z.any(),
});

const outputSchema = GetTaskResultSchema;

const stateSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  authInfo: z.any() as z.ZodType<AuthInfo>,
});

const plan = {
  pre: ['parseInput'],
  execute: ['fetchAndRespond'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tasks:get': FlowRunOptions<TasksGetFlow, typeof plan, typeof inputSchema, typeof outputSchema, typeof stateSchema>;
  }
}

const name = 'tasks:get' as const;
const { Stage } = FlowHooksOf<'tasks:get'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class TasksGetFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('TasksGetFlow');

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
      throw new InvalidInputError('Invalid tasks/get request', e instanceof z.ZodError ? e.issues : undefined);
    }
    if (method !== 'tasks/get') {
      throw new InvalidMethodError(method, 'tasks/get');
    }
    const authInfo = ctx?.authInfo;
    if (!authInfo?.sessionId) {
      throw new InternalMcpError('Session ID missing in authorized flow', 'AUTH_INFO_MISSING');
    }
    this.state.set({ taskId: params.taskId, sessionId: authInfo.sessionId, authInfo });
  }

  @Stage('fetchAndRespond')
  async fetchAndRespond() {
    const store = this.scope.taskStore;
    if (!store) throw new TaskStoreNotInitializedError();
    const { taskId, sessionId } = this.state.required;
    const record = await store.get(taskId, sessionId);
    if (!record) throw new TaskNotFoundError(taskId);
    // Per spec §Related Task Metadata: tasks/get result SHOULD NOT include the
    // `io.modelcontextprotocol/related-task` meta — taskId is already in the body.
    this.respond(toWireShape(record));
  }
}
