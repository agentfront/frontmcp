import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';
import { PublicMcpError } from '../../../errors';
import { type Scope } from '../../../scope/scope.instance';
import { type TaskStore } from '../../../task/store';
import { isTerminal, type TaskRecord } from '../../../task/task.types';

const KEY = 'sk-tasks-errors-0001';
const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };
const PUBLIC_MESSAGE = 'There are no open tickets to export.';
const INTERNAL_DETAIL = 'connect ECONNREFUSED 10.0.4.7:5432';
const MODES = ['fail-public', 'throw-public', 'throw-internal'] as const;

@Tool({
  name: 'export_tickets',
  inputSchema: { mode: z.enum(MODES) },
  execution: { taskSupport: 'optional' },
})
class ExportTicketsTool extends ToolContext {
  async execute({ mode }: { mode: string }) {
    if (mode === 'fail-public') this.fail(new PublicMcpError(PUBLIC_MESSAGE, 'NOTHING_TO_EXPORT'));
    if (mode === 'throw-public') throw new PublicMcpError(PUBLIC_MESSAGE, 'NOTHING_TO_EXPORT');
    throw new Error(INTERNAL_DETAIL);
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [ExportTicketsTool] })
class HelpDeskApp {}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  _meta?: { code?: string; errorId?: string };
}

const auth = { authorization: `Bearer ${KEY}` };

function expectNoInternalDetail(...values: unknown[]): void {
  const serialized = JSON.stringify(values);
  expect(serialized).not.toContain('ECONNREFUSED');
  expect(serialized).not.toContain('10.0.4.7');
  expect(serialized).not.toContain('5432');
}

async function settled(store: TaskStore, taskId: string, owner: string): Promise<TaskRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const record = await store.get(taskId, owner);
    if (record && isTerminal(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task ${taskId} never settled`);
}

describe('a tool error in a task', () => {
  let server: TestFetchServer;
  let scope: Scope;
  let store: TaskStore;
  const previousNodeEnv = process.env['NODE_ENV'];

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'tasks-error-mapping', version: '1.0.0' },
      apps: [HelpDeskApp],
      auth: { mode: 'static', tokens: [KEY] },
      tasks: { enabled: true, defaultTtlMs: 60_000, defaultPollIntervalMs: 20 },
    });
    scope = server.instance.getScopes()[0] as Scope;
    const taskStore = scope.taskStore;
    if (!taskStore) throw new Error('the server has no task store');
    store = taskStore;
  });

  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
  });

  afterEach(() => {
    process.env['NODE_ENV'] = previousNodeEnv;
    jest.restoreAllMocks();
  });

  async function callInline(mode: string): Promise<ToolResult> {
    const response = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'export_tickets', arguments: { mode } },
      { headers: auth },
    );
    return response.message.result as unknown as ToolResult;
  }

  /** Each call has its own error id, and outside production its own stack after the first line. */
  function textOf(result: ToolResult): string | undefined {
    return result.content[0]?.text.split('\n')[0]?.replace(/err_[0-9a-f]+/g, 'err_ID');
  }

  function expectSameAsInline(taskResult: ToolResult, inline: ToolResult): void {
    expect(taskResult.isError).toBe(true);
    expect(taskResult.content).toHaveLength(inline.content.length);
    expect(textOf(taskResult)).toBe(textOf(inline));
    expect(taskResult._meta?.code).toBe(inline._meta?.code);
    expect(taskResult._meta?.errorId).toMatch(/^err_/);
  }

  describe('under protocol 2026-07-28', () => {
    async function runAsTask(mode: string) {
      const created = jest.spyOn(store, 'createWithinLimit');
      const createResponse = await rpc20260728(
        server.handler,
        'tools/call',
        { name: 'export_tickets', arguments: { mode } },
        { capabilities: TASKS_EXT, headers: auth },
      );
      const owner = created.mock.calls[0]?.[0].sessionId;
      const taskId = (createResponse.message.result as { task?: { taskId?: string } } | undefined)?.task?.taskId;
      if (!owner || !taskId) throw new Error(`no task was created: ${JSON.stringify(createResponse.message)}`);
      const record = await settled(store, taskId, owner);
      const getResponse = await rpc20260728(
        server.handler,
        'tasks/get',
        { taskId },
        { capabilities: TASKS_EXT, headers: auth },
      );
      return { record, createResponse: createResponse.message, task: getResponse.message.result ?? {} };
    }

    it.each(MODES)('reads exactly as an inline call does: %s', async (mode) => {
      const inline = await callInline(mode);
      const { record, createResponse, task } = await runAsTask(mode);

      expect(task['status']).toBe('completed');
      expect(task['error']).toBeUndefined();
      expectSameAsInline(task['result'] as ToolResult, inline);
      expectNoInternalDetail(record, createResponse, task);
    });

    it('carries the public message and code of a PublicMcpError', async () => {
      const { task } = await runAsTask('fail-public');

      expect((task['result'] as ToolResult).content[0]?.text).toBe(PUBLIC_MESSAGE);
      expect((task['result'] as ToolResult)._meta?.code).toBe('NOTHING_TO_EXPORT');
    });

    it('hides an internal error behind the error id in production', async () => {
      const { task } = await runAsTask('throw-internal');

      expect((task['result'] as ToolResult).content[0]?.text).toMatch(
        /^Internal FrontMCP error\. Please contact support with error ID: err_[0-9a-f]+$/,
      );
    });

    it('shows the internal error outside production, as an inline call does', async () => {
      process.env['NODE_ENV'] = 'development';
      const inline = await callInline('throw-internal');
      const { task } = await runAsTask('throw-internal');

      expect(textOf(task['result'] as ToolResult)).toBe(textOf(inline));
      expect(inline.content[0]?.text).toContain(INTERNAL_DETAIL);
    });
  });

  describe('under protocol 2025-11-25', () => {
    const SESSION_ID = 'session-task-errors';
    const ctx = () => ({ authInfo: { sessionId: SESSION_ID } });

    async function runAsTask(mode: string) {
      const notifications = jest.spyOn(scope.notifications, 'sendNotificationToSession');
      const created = (await scope.runFlowForOutput('tools:call-tool', {
        request: { method: 'tools/call', params: { name: 'export_tickets', arguments: { mode }, task: {} } },
        ctx: ctx(),
      })) as unknown as { task: { taskId: string } };
      const taskId = created.task.taskId;
      const record = await settled(store, taskId, SESSION_ID);
      const task = await scope.runFlowForOutput('tasks:get', {
        request: { method: 'tasks/get', params: { taskId } },
        ctx: ctx(),
      });
      const result = await scope.runFlowForOutput('tasks:result', {
        request: { method: 'tasks/result', params: { taskId } },
        ctx: ctx(),
      });
      return { record, created, task, result, notifications: notifications.mock.calls };
    }

    it.each(MODES)('replays exactly what an inline call returns: %s', async (mode) => {
      const inline = await callInline(mode);
      const { record, created, task, result, notifications } = await runAsTask(mode);

      expect(task.status).toBe('failed');
      expectSameAsInline(result as unknown as ToolResult, inline);
      expectNoInternalDetail(record, created, task, result, notifications);
    });
  });
});
