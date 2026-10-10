import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type Rpc20260728Response,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';
import { TaskConcurrencyLimitError } from '../../../errors';
import { type Scope } from '../../../scope/scope.instance';

const KEY = 'sk-tasks-limit-0001';
const OTHER_KEY = 'sk-tasks-limit-0002';
const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };

const pendingRuns: Array<() => void> = [];

function finishRunningTasks(): void {
  for (const finish of pendingRuns.splice(0)) finish();
}

@Tool({ name: 'export_report', inputSchema: {}, execution: { taskSupport: 'optional' } })
class ExportReportTool extends ToolContext {
  async execute() {
    await new Promise<void>((resolve) => pendingRuns.push(resolve));
    return { done: true };
  }
}

@App({ id: 'reports', name: 'Reports', tools: [ExportReportTool] })
class ReportsApp {}

function startTask(server: TestFetchServer, key: string): Promise<Rpc20260728Response> {
  return rpc20260728(
    server.handler,
    'tools/call',
    { name: 'export_report', arguments: {} },
    { capabilities: TASKS_EXT, headers: { authorization: `Bearer ${key}` } },
  );
}

function outcomeOf(response: Rpc20260728Response): string {
  if (response.message.error) return `jsonrpc ${response.message.error.code}`;
  const result = response.message.result as { resultType?: string; isError?: boolean; _meta?: { code?: string } };
  if (result.resultType === 'task') return 'task';
  return result.isError ? String(result._meta?.code) : 'inline';
}

async function waitUntilFinished(server: TestFetchServer, key: string, started: Rpc20260728Response) {
  const taskId = (started.message.result as { task: { taskId: string } }).task.taskId;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const polled = await rpc20260728(
      server.handler,
      'tasks/get',
      { taskId },
      { capabilities: TASKS_EXT, headers: { authorization: `Bearer ${key}` } },
    );
    if ((polled.message.result as { status?: string } | undefined)?.status === 'completed') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task ${taskId} never completed`);
}

describe('tasks.maxConcurrentPerSession', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'tasks-concurrency-limit', version: '1.0.0' },
      apps: [ReportsApp],
      auth: { mode: 'static', tokens: [KEY, OTHER_KEY] },
      tasks: { enabled: true, defaultTtlMs: 60_000, maxConcurrentPerSession: 1 },
    });
  });

  afterEach(() => finishRunningTasks());

  describe('under protocol 2026-07-28, per authenticated subject', () => {
    it('refuses a task over the cap like the guard does, and admits one once a task finishes', async () => {
      const responses = await Promise.all([startTask(server, KEY), startTask(server, KEY), startTask(server, KEY)]);
      const outcomes = responses.map(outcomeOf);

      expect(outcomes.filter((outcome) => outcome === 'task')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'CONCURRENCY_LIMIT')).toHaveLength(2);
      const refused = responses.find((response) => outcomeOf(response) === 'CONCURRENCY_LIMIT');
      expect(JSON.stringify(refused?.message.result)).toContain(
        'Too many tasks in progress for this caller (at most 1 at once)',
      );

      const started = responses.find((response) => outcomeOf(response) === 'task');
      if (!started) throw new Error('no task was started');
      finishRunningTasks();
      await waitUntilFinished(server, KEY, started);

      expect(outcomeOf(await startTask(server, KEY))).toBe('task');
    });

    it('counts each caller separately', async () => {
      await startTask(server, KEY);

      expect(outcomeOf(await startTask(server, OTHER_KEY))).toBe('task');
    });
  });

  describe('under protocol 2025-11-25, per session', () => {
    function callAsTask(sessionId: string | undefined) {
      const scope = server.instance.getScopes()[0] as Scope;
      return scope.runFlowForOutput('tools:call-tool', {
        request: { method: 'tools/call', params: { name: 'export_report', arguments: {}, task: {} } },
        ctx: { authInfo: sessionId === undefined ? {} : { sessionId } },
      });
    }

    it('refuses a second task in the same session and admits one in another session', async () => {
      await callAsTask('session-1');

      await expect(callAsTask('session-1')).rejects.toBeInstanceOf(TaskConcurrencyLimitError);
      await expect(callAsTask('session-2')).resolves.toBeDefined();
    });

    it('creates no task for a caller with neither a session nor an authenticated subject', async () => {
      await expect(callAsTask(undefined)).rejects.toThrow('Task-augmented tools/call requires an identified session');
    });
  });
});
