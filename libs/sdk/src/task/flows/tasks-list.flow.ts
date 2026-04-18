/**
 * tasks/list flow — paginated, session-scoped list of tasks.
 *
 * Per MCP 2025-11-25 §Task Listing and §Security: we only return tasks owned
 * by the requesting session. The list capability is advertised only when
 * requestors are identifiable; otherwise listing tasks would leak metadata.
 *
 * @module task/flows/tasks-list.flow
 */

import { z } from 'zod';

import { ListTasksRequestSchema, ListTasksResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { InternalMcpError, InvalidInputError, InvalidMethodError, TaskStoreNotInitializedError } from '../../errors';
import { toWireShape } from '../task.types';

const inputSchema = z.object({
  request: ListTasksRequestSchema,
  ctx: z.any(),
});

const outputSchema = ListTasksResultSchema;

const stateSchema = z.object({
  sessionId: z.string(),
  cursor: z.string().optional(),
  authInfo: z.any() as z.ZodType<AuthInfo>,
});

const plan = {
  pre: ['parseInput'],
  execute: ['listAndRespond'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tasks:list': FlowRunOptions<
      TasksListFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tasks:list' as const;
const { Stage } = FlowHooksOf<'tasks:list'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class TasksListFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('TasksListFlow');

  @Stage('parseInput')
  async parseInput() {
    let method!: string;
    let params: { cursor?: string } | undefined;
    let ctx: { authInfo?: AuthInfo } | undefined;
    try {
      const parsed = inputSchema.parse(this.rawInput);
      method = parsed.request.method;
      params = parsed.request.params;
      ctx = parsed.ctx as { authInfo?: AuthInfo } | undefined;
    } catch (e) {
      throw new InvalidInputError('Invalid tasks/list request', e instanceof z.ZodError ? e.issues : undefined);
    }
    if (method !== 'tasks/list') {
      throw new InvalidMethodError(method, 'tasks/list');
    }
    const authInfo = ctx?.authInfo;
    if (!authInfo?.sessionId) {
      throw new InternalMcpError('Session ID missing in authorized flow', 'AUTH_INFO_MISSING');
    }
    this.state.set({ sessionId: authInfo.sessionId, cursor: params?.cursor, authInfo });
  }

  @Stage('listAndRespond')
  async listAndRespond() {
    const store = this.scope.taskStore;
    if (!store) throw new TaskStoreNotInitializedError();
    const sessionId = this.state.required.sessionId;
    const cursor = this.state.cursor;
    const page = await store.list(sessionId, { cursor });
    const tasks = page.tasks.map(toWireShape);
    const response: { tasks: typeof tasks; nextCursor?: string } = { tasks };
    if (page.nextCursor) response.nextCursor = page.nextCursor;
    this.respond(response);
  }
}
