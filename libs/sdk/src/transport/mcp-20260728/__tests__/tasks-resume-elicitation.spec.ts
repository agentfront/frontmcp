/**
 * A task resumed by an unversioned `tasks/update` keeps the revision the request actually declared.
 *
 * `createFetchHandler()` serves a request that names no revision as MCP 2026-07-28 by default. A tool
 * that asks such a caller for input without the elicitation capability gets
 * `ElicitationNotSupportedError`, as a legacy-protocol call does, not the 2026-only `-32021` (#629).
 * `tasks/update` resumes a parked tool through a second MRTR exchange, which must carry the same
 * "the client didn't declare the revision" status.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

const KEY = 'sk-tasks-resume-0001';
const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };

@Tool({ name: 'two_questions', inputSchema: {}, execution: { taskSupport: 'optional' } })
class TwoQuestionsTool extends ToolContext {
  async execute() {
    const first = await this.elicit('First question?', z.object({ ok: z.boolean() }));
    const second = await this.elicit('Second question?', z.object({ ok: z.boolean() }));
    return { first: first.status, second: second.status };
  }
}

@App({ id: 'questions', name: 'Questions', tools: [TwoQuestionsTool] })
class QuestionsApp {}

interface TaskWire {
  status?: string;
  inputRequests?: Record<string, unknown>;
  statusMessage?: string;
  error?: unknown;
  result?: unknown;
}

const auth = { authorization: `Bearer ${KEY}` };

async function getTask(server: TestFetchServer, taskId: string): Promise<TaskWire> {
  const response = await rpc20260728(
    server.handler,
    'tasks/get',
    { taskId },
    { capabilities: TASKS_EXT, headers: auth },
  );
  return (response.message?.result ?? {}) as TaskWire;
}

async function pollUntil(
  server: TestFetchServer,
  taskId: string,
  done: (task: TaskWire) => boolean,
): Promise<TaskWire> {
  const deadline = Date.now() + 10_000;
  let last: TaskWire = {};
  while (Date.now() < deadline) {
    last = await getTask(server, taskId);
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`task never settled: ${JSON.stringify(last)}`);
}

/** A `tasks/update` that names no revision (no header, no `_meta` protocol version) and no elicitation capability. */
async function unversionedTasksUpdate(server: TestFetchServer, params: Record<string, unknown>) {
  const response = await server.handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...auth },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tasks/update',
        params: { ...params, _meta: { [MCP_20260728_META.clientCapabilities]: TASKS_EXT } },
      }),
    }),
  );
  return response.status;
}

describe('a task resumed by an unversioned tasks/update', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'tasks-resume-elicitation', version: '1.0.0' },
      apps: [QuestionsApp],
      auth: { mode: 'static', tokens: [KEY] },
      elicitation: { enabled: true },
      tasks: { enabled: true, defaultTtlMs: 60_000, defaultPollIntervalMs: 20 },
    });
  });

  it('refuses a further elicitation as ElicitationNotSupportedError, not -32021', async () => {
    const created = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'two_questions', arguments: {} },
      { capabilities: { ...TASKS_EXT, elicitation: { form: {} } }, headers: auth },
    );
    const taskId = (created.message?.result as { task?: { taskId?: string } } | undefined)?.task?.taskId;
    if (!taskId) throw new Error(`no task was created: ${JSON.stringify(created.message)}`);

    const paused = await pollUntil(server, taskId, (task) => task.status === 'input_required');
    const [key] = Object.keys(paused.inputRequests ?? {});
    if (!key) throw new Error(`the task asked for nothing: ${JSON.stringify(paused)}`);

    expect(
      await unversionedTasksUpdate(server, {
        taskId,
        inputResponses: { [key]: { action: 'accept', content: { ok: true } } },
      }),
    ).toBe(200);

    const settled = await pollUntil(
      server,
      taskId,
      (task) => task.status !== 'input_required' && task.status !== 'working',
    );
    const report = JSON.stringify(settled);

    // The MRTR missing-capability answer ("requires the `elicitation` client capability", -32021) is
    // the 2026-only one; a caller that never declared the revision is refused as a legacy caller is.
    expect(settled.status).toBe('failed');
    expect(report).toMatch(/does not support elicitation/);
    expect(report).not.toContain('requires the `elicitation` client capability');
  });
});
