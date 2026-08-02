/**
 * `io.modelcontextprotocol/tasks` extension — SEP-2663.
 *
 * Tasks left the core protocol and were redesigned: polling `tasks/get`
 * replaces the blocking `tasks/result`, `tasks/update` feeds a paused task,
 * `tasks/list` is gone, and a task handle is returned unsolicited whenever the
 * CLIENT declares the extension.
 */
import { expect, test } from '@frontmcp/testing';

import {
  mcpStatelessFetch,
  METHOD_NOT_FOUND,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type InputRequest,
  type TaskWire,
} from './helpers/mcp-stateless-client';

const JWT_SECRET = 'protocol-2026-tasks-e2e-secret-0123456789';
const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };

/** Poll `tasks/get` until the task leaves `working`, or time out. */
async function pollUntil(
  baseUrl: string,
  token: string,
  taskId: string,
  predicate: (task: TaskWire) => boolean,
  timeoutMs = 15_000,
): Promise<TaskWire> {
  const deadline = Date.now() + timeoutMs;
  let last: TaskWire | undefined;
  let id = 9000;
  while (Date.now() < deadline) {
    const res = await mcpStatelessFetch(baseUrl, {
      method: 'tasks/get',
      id: id++,
      params: { taskId },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });
    last = res.json().result;
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`Task never satisfied predicate. Last state: ${JSON.stringify(last)}`);
}

test.describe('protocol 2026-07-28 — tasks extension', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main-tasks.ts',
    project: 'demo-e2e-protocol-20260728',
    env: { JWT_SECRET },
  });

  test('advertises the extension in server/discover', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-discover', scopes: ['anonymous'] });
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'server/discover',
      id: 1,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().result.capabilities.extensions['io.modelcontextprotocol/tasks']).toBeDefined();
  });

  test('returns resultType "task" when the client declares the extension', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-create', scopes: ['anonymous'] });
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 2,
      params: { name: 'slow-job', arguments: { label: 'build' } },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const { result, error } = res.json();
    expect(error).toBeUndefined();
    expect(result.resultType).toBe('task');
    expect(result.task.taskId).toEqual(expect.any(String));
    expect(result.task.status).toBe('working');
  });

  test('uses the 2026 field names on the task handle', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-fields', scopes: ['anonymous'] });
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 3,
      params: { name: 'slow-job', arguments: {} },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });

    const { task } = res.json().result;
    // Renamed from `ttl` / `pollInterval` in the 2025-11-25 core protocol.
    expect(typeof task.ttlMs).toBe('number');
    expect(typeof task.pollIntervalMs).toBe('number');
    expect(task.ttl).toBeUndefined();
    expect(task.pollInterval).toBeUndefined();
  });

  test('runs inline when the client did NOT declare the extension', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-inline', scopes: ['anonymous'] });
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 4,
      params: { name: 'slow-job', arguments: { label: 'inline' } },
      clientCapabilities: {},
      headers: { authorization: `Bearer ${token}` },
    });

    // Never hand a task to a client that cannot poll for it.
    const { result } = res.json();
    expect(result.resultType).toBe('complete');
    expect(JSON.stringify(result.structuredContent ?? result.content)).toContain('inline');
  });

  test('polls to completion via tasks/get and carries the result', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-poll', scopes: ['anonymous'] });
    const created = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 5,
      params: { name: 'slow-job', arguments: { label: 'polled' } },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });

    const { taskId } = created.json().result.task;
    const done = await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'completed');

    expect(done.status).toBe('completed');
    expect(JSON.stringify(done.result)).toContain('polled');
  });

  test('requires the extension to call tasks/get', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-nocap', scopes: ['anonymous'] });
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tasks/get',
      id: 6,
      params: { taskId: 'whatever' },
      clientCapabilities: {},
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
  });

  test('hides another principal’s task behind the same not-found error', async ({ server, auth }) => {
    const owner = await auth.createToken({ sub: 'user-owner', scopes: ['anonymous'] });
    const stranger = await auth.createToken({ sub: 'user-stranger', scopes: ['anonymous'] });

    const created = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 7,
      params: { name: 'slow-job', arguments: {} },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${owner}` },
    });
    const { taskId } = created.json().result.task;

    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tasks/get',
      id: 8,
      params: { taskId },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${stranger}` },
    });

    // A task id must not become an existence oracle across principals.
    expect(res.json().error.message).toBe('Task not found');
  });

  test('tasks/list and tasks/result are gone', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-removed', scopes: ['anonymous'] });
    for (const [index, method] of ['tasks/list', 'tasks/result'].entries()) {
      const res = await mcpStatelessFetch(server.info.baseUrl, {
        method,
        id: 10 + index,
        params: { taskId: 'x' },
        clientCapabilities: TASKS_EXT,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
      expect(res.json().error.code).toBe(METHOD_NOT_FOUND);
    }
  });

  test('cancels a task', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'user-cancel', scopes: ['anonymous'] });
    const created = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 12,
      params: { name: 'slow-job', arguments: { delayMs: 3000 } },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });
    const { taskId } = created.json().result.task;

    const cancelled = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tasks/cancel',
      id: 13,
      params: { taskId },
      clientCapabilities: TASKS_EXT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cancelled.json().error).toBeUndefined();

    const state = await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'cancelled');
    expect(state.status).toBe('cancelled');
  });

  test.describe('mid-flight input', () => {
    test('parks the task in input_required with pending inputRequests', async ({ server, auth }) => {
      const token = await auth.createToken({ sub: 'user-input', scopes: ['anonymous'] });
      const created = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'tools/call',
        id: 14,
        params: { name: 'approve-job', arguments: { change: 'deploy v2' } },
        clientCapabilities: { ...TASKS_EXT, elicitation: { form: {} } },
        headers: { authorization: `Bearer ${token}` },
      });

      const { taskId } = created.json().result.task;
      const paused = await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'input_required');

      const entries = Object.entries(paused.inputRequests ?? {});
      expect(entries.length).toBeGreaterThan(0);
      const [, request] = entries[0] as [string, InputRequest];
      expect(request.method).toBe('elicitation/create');
      expect(request.params.message).toContain('deploy v2');
    });

    test('resumes and completes after tasks/update', async ({ server, auth }) => {
      const token = await auth.createToken({ sub: 'user-resume', scopes: ['anonymous'] });
      const created = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'tools/call',
        id: 15,
        params: { name: 'approve-job', arguments: { change: 'deploy v3' } },
        clientCapabilities: { ...TASKS_EXT, elicitation: { form: {} } },
        headers: { authorization: `Bearer ${token}` },
      });
      const { taskId } = created.json().result.task;

      const paused = await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'input_required');
      const [key] = Object.keys(paused.inputRequests);

      const updated = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'tasks/update',
        id: 16,
        params: { taskId, inputResponses: { [key]: { action: 'accept', content: { approved: true } } } },
        clientCapabilities: { ...TASKS_EXT, elicitation: { form: {} } },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(updated.json().error).toBeUndefined();

      const done = await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'completed');
      expect(JSON.stringify(done.result)).toContain('"approved":true');
    });

    test('rejects tasks/update for a task that is not awaiting input', async ({ server, auth }) => {
      const token = await auth.createToken({ sub: 'user-badupdate', scopes: ['anonymous'] });
      const created = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'tools/call',
        id: 17,
        params: { name: 'slow-job', arguments: {} },
        clientCapabilities: TASKS_EXT,
        headers: { authorization: `Bearer ${token}` },
      });
      const { taskId } = created.json().result.task;
      await pollUntil(server.info.baseUrl, token, taskId, (t) => t.status === 'completed');

      const res = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'tasks/update',
        id: 18,
        params: { taskId, inputResponses: { 'elicitation-1': { action: 'accept' } } },
        clientCapabilities: TASKS_EXT,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.json().error.message).toContain('not awaiting input');
    });
  });
});
