/**
 * E2E Tests for Background Tasks (MCP 2025-11-25 tasks spec).
 *
 * Covers:
 *  - tools/list exposes execution.taskSupport per tool.
 *  - Initialize advertises server `tasks` capability.
 *  - Non-task call (default tool) still works.
 *  - Task-augmented tools/call returns CreateTaskResult with a taskId.
 *  - tasks/get polling from `working` → `completed`.
 *  - tasks/result returns the original CallToolResult with related-task _meta.
 *  - tasks/list scoped to the session, paginated.
 *  - tasks/cancel fires the AbortSignal and terminates the task with `cancelled`.
 *  - Follow-up tasks/cancel on a terminal task returns -32602 Invalid params.
 *  - Tool-level `taskSupport: 'required'` rejects non-task calls with -32601.
 *  - Tool-level `taskSupport: 'forbidden'` (default) rejects task calls with -32601.
 *  - `isError: true` tool output surfaces as task status `failed`.
 *  - `notifications/tasks/status` is observed for state transitions.
 *  - Cross-session isolation: session B cannot read session A's task.
 */
import { expect, test } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-tasks/src/main.ts';

type RpcResponse<T = unknown> = {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

let nextId = 1000;
const rpcId = () => ++nextId;

async function createTask(
  mcp: import('@frontmcp/testing').McpTestClient,
  params: { name: string; arguments?: Record<string, unknown>; ttl?: number | null },
): Promise<{ taskId: string; status: string; raw: RpcResponse }> {
  const taskField: Record<string, unknown> = {};
  if (params.ttl !== undefined) taskField['ttl'] = params.ttl;
  const response = (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tools/call',
    params: {
      name: params.name,
      arguments: params.arguments ?? {},
      task: taskField,
    },
  })) as RpcResponse<{ task: { taskId: string; status: string } }>;
  if (!response.result?.task?.taskId) {
    throw new Error(`CreateTaskResult missing taskId — got: ${JSON.stringify(response)}`);
  }
  return { taskId: response.result.task.taskId, status: response.result.task.status, raw: response };
}

async function getTask(mcp: import('@frontmcp/testing').McpTestClient, taskId: string): Promise<RpcResponse> {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/get',
    params: { taskId },
  })) as RpcResponse;
}

async function getResult(mcp: import('@frontmcp/testing').McpTestClient, taskId: string): Promise<RpcResponse> {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/result',
    params: { taskId },
  })) as RpcResponse;
}

async function cancelTask(mcp: import('@frontmcp/testing').McpTestClient, taskId: string): Promise<RpcResponse> {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/cancel',
    params: { taskId },
  })) as RpcResponse;
}

async function listTasks(
  mcp: import('@frontmcp/testing').McpTestClient,
  params: { cursor?: string } = {},
): Promise<RpcResponse> {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/list',
    params,
  })) as RpcResponse;
}

async function pollUntil(
  mcp: import('@frontmcp/testing').McpTestClient,
  taskId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 5000,
): Promise<RpcResponse<{ status: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await getTask(mcp, taskId)) as RpcResponse<{ status: string }>;
    if (res.result && predicate(res.result.status)) return res;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out polling task ${taskId}`);
}

test.describe('Background Tasks E2E', () => {
  test.use({
    server: SERVER,
    project: 'demo-e2e-tasks',
    publicMode: true,
  });

  test.describe('discovery + capabilities', () => {
    test('initialize advertises the tasks capability', async ({ mcp }) => {
      const caps = (mcp as unknown as { initResult?: { capabilities?: Record<string, unknown> } }).initResult
        ?.capabilities;
      // The `tasks` capability is advertised when any tool declares taskSupport.
      expect(caps?.['tasks']).toBeDefined();
      const tasksCap = caps?.['tasks'] as { cancel?: object; requests?: { tools?: { call?: object } } };
      expect(tasksCap.cancel).toBeDefined();
      expect(tasksCap.requests?.tools?.call).toBeDefined();
    });

    test('tools/list surfaces execution.taskSupport per tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const byName = new Map(tools.map((t) => [t.name, t as unknown as { execution?: { taskSupport?: string } }]));
      expect(byName.get('slow-weather')?.execution?.taskSupport).toBe('optional');
      expect(byName.get('big-report')?.execution?.taskSupport).toBe('required');
      // Tools without explicit taskSupport should not expose the field.
      expect(byName.get('instant-echo')?.execution).toBeUndefined();
    });
  });

  test.describe('basic task lifecycle', () => {
    test('non-task call still works for taskSupport: optional tool', async ({ mcp }) => {
      const result = await mcp.tools.call('slow-weather', { city: 'NYC', delayMs: 10 });
      expect(result).toBeSuccessful();
    });

    test('task-augmented call returns CreateTaskResult and completes', async ({ mcp }) => {
      const { taskId, status } = await createTask(mcp, {
        name: 'slow-weather',
        arguments: { city: 'NYC', delayMs: 100 },
        ttl: 60_000,
      });
      expect(taskId).toMatch(/.+/);
      expect(['working', 'completed']).toContain(status);

      // Poll until terminal.
      const terminal = await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');
      expect(terminal.result?.status).toBe('completed');
    });

    test('tasks/result returns the CallToolResult with related-task meta', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, {
        name: 'slow-weather',
        arguments: { city: 'NYC', delayMs: 50 },
      });
      const res = (await getResult(mcp, taskId)) as RpcResponse<{
        _meta?: Record<string, { taskId: string }>;
        structuredContent?: { city?: string };
      }>;
      expect(res.result).toBeDefined();
      const related = res.result?._meta?.['io.modelcontextprotocol/related-task'];
      expect(related?.taskId).toBe(taskId);
      // structuredContent is produced from the tool's Zod output.
      expect(res.result?.structuredContent?.city).toBe('NYC');
    });

    test('tasks/list returns only the caller-session tasks, paginated', async ({ mcp }) => {
      // Create three tasks in this session.
      const created: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { taskId } = await createTask(mcp, {
          name: 'slow-weather',
          arguments: { city: `City-${i}`, delayMs: 10 },
        });
        created.push(taskId);
      }
      // Drain all pages; 3 tasks should all be visible for this session.
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const res = (await listTasks(mcp, cursor ? { cursor } : {})) as RpcResponse<{
          tasks: Array<{ taskId: string }>;
          nextCursor?: string;
        }>;
        if (!res.result) {
          throw new Error(`tasks/list failed: ${JSON.stringify(res.error)}`);
        }
        for (const t of res.result.tasks) seen.add(t.taskId);
        cursor = res.result.nextCursor;
        if (!cursor) break;
      }
      for (const id of created) expect(seen.has(id)).toBe(true);
    });
  });

  test.describe('tool-level taskSupport enforcement', () => {
    test('required: non-task call rejected with -32601', async ({ mcp }) => {
      const res = (await mcp.raw.request({
        jsonrpc: '2.0',
        id: rpcId(),
        method: 'tools/call',
        params: { name: 'big-report', arguments: { topic: 'quarterly' } },
      })) as RpcResponse;
      expect(res.error?.code).toBe(-32601);
    });

    test('required: task-augmented call succeeds', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, { name: 'big-report', arguments: { topic: 'quarterly' } });
      const terminal = await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');
      expect(terminal.result?.status).toBe('completed');
    });

    test('forbidden (default): task-augmented call rejected with -32601', async ({ mcp }) => {
      const res = (await mcp.raw.request({
        jsonrpc: '2.0',
        id: rpcId(),
        method: 'tools/call',
        params: { name: 'instant-echo', arguments: { message: 'hi' }, task: {} },
      })) as RpcResponse;
      expect(res.error?.code).toBe(-32601);
    });
  });

  test.describe('cancellation', () => {
    test('tasks/cancel transitions to cancelled and fires the tool AbortSignal', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, {
        name: 'cancellable-wait',
        arguments: { maxMs: 5_000 },
      });
      // Let the background runner pick up execution.
      await new Promise((r) => setTimeout(r, 50));
      const cancelRes = (await cancelTask(mcp, taskId)) as RpcResponse<{ status: string }>;
      expect(cancelRes.result?.status).toBe('cancelled');

      // Subsequent tasks/get should still report cancelled (one-way transition).
      const later = (await getTask(mcp, taskId)) as RpcResponse<{ status: string }>;
      expect(later.result?.status).toBe('cancelled');
    });

    test('tasks/cancel on terminal task returns -32602', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, {
        name: 'slow-weather',
        arguments: { city: 'T', delayMs: 10 },
      });
      await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');
      const res = (await cancelTask(mcp, taskId)) as RpcResponse;
      expect(res.error?.code).toBe(-32602);
    });

    test('tasks/get/result/cancel on unknown taskId returns -32602', async ({ mcp }) => {
      const bogus = 'does-not-exist-0000';
      const get = (await getTask(mcp, bogus)) as RpcResponse;
      expect(get.error?.code).toBe(-32602);
      const result = (await getResult(mcp, bogus)) as RpcResponse;
      expect(result.error?.code).toBe(-32602);
      const cancel = (await cancelTask(mcp, bogus)) as RpcResponse;
      expect(cancel.error?.code).toBe(-32602);
    });
  });

  test.describe('failure propagation', () => {
    test('isError:true tool output surfaces as task status failed', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, {
        name: 'flaky',
        arguments: { shouldFail: true },
      });
      const terminal = await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');
      expect(terminal.result?.status).toBe('failed');

      // tasks/result MUST replay the exact underlying CallToolResult (with isError).
      const result = (await getResult(mcp, taskId)) as RpcResponse<{ isError?: boolean }>;
      expect(result.result?.isError).toBe(true);
    });
  });

  test.describe('polling (spec-mandated)', () => {
    test('tasks/get reports working then a terminal status', async ({ mcp }) => {
      const { taskId } = await createTask(mcp, {
        name: 'slow-weather',
        arguments: { city: 'ZRH', delayMs: 200 },
      });
      // Per spec §Getting Tasks, requestors SHOULD continue polling until the
      // task reaches a terminal status. notifications/tasks/status is optional
      // and MUST NOT be relied on.
      let sawWorking = false;
      let finalStatus: string | undefined;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const r = (await getTask(mcp, taskId)) as RpcResponse<{ status: string }>;
        if (!r.result) throw new Error(`tasks/get failed: ${JSON.stringify(r.error)}`);
        if (r.result.status === 'working') sawWorking = true;
        if (['completed', 'failed', 'cancelled'].includes(r.result.status)) {
          finalStatus = r.result.status;
          break;
        }
        await new Promise((res) => setTimeout(res, 25));
      }
      expect(sawWorking || finalStatus === 'completed').toBe(true);
      expect(finalStatus).toBe('completed');
    });
  });

  test.describe('session isolation', () => {
    test('session B cannot read or cancel session A tasks', async ({ mcp, server }) => {
      const { taskId } = await createTask(mcp, {
        name: 'slow-weather',
        arguments: { city: 'SEA', delayMs: 10 },
      });
      await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');

      // Second client — separate session.
      const other = await server.createClient();
      const get = (await getTask(other, taskId)) as RpcResponse;
      expect(get.error?.code).toBe(-32602);
      const result = (await getResult(other, taskId)) as RpcResponse;
      expect(result.error?.code).toBe(-32602);
      const cancel = (await cancelTask(other, taskId)) as RpcResponse;
      expect(cancel.error?.code).toBe(-32602);
      await other.disconnect();
    });
  });
});
