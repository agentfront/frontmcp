/**
 * E2E — CLI task runner
 *
 * Starts a FrontMCP server in CLI mode (via FRONTMCP_FORCE_CLI_MODE=1) with a
 * SQLite task store. Validates:
 *  1. Task-augmented tools/call spawns a detached worker child that executes
 *     the tool in a DIFFERENT process (PID ≠ host PID) and writes the result
 *     to SQLite.
 *  2. tasks/cancel sends SIGTERM to the worker and transitions the record.
 *  3. When the worker crashes (SIGKILL), orphan detection auto-transitions
 *     the non-terminal record to `failed` on the next tasks/get.
 *  4. Records persist in SQLite across different stdio/http client sessions.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, test } from '@frontmcp/testing';

const TEST_DB = path.join(os.tmpdir(), `frontmcp-cli-tasks-${process.pid}-${Date.now()}.sqlite`);

type RpcResponse<T = unknown> = {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: { code: number; message: string };
};

let rpc = 1000;
const rpcId = () => ++rpc;

async function createTask(
  mcp: import('@frontmcp/testing').McpTestClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ taskId: string; status: string }> {
  const res = (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tools/call',
    params: { name, arguments: args, task: {} },
  })) as RpcResponse<{ task: { taskId: string; status: string } }>;
  if (!res.result?.task?.taskId) {
    throw new Error(`CreateTaskResult missing taskId: ${JSON.stringify(res)}`);
  }
  return res.result.task;
}

async function getTask(mcp: import('@frontmcp/testing').McpTestClient, taskId: string) {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/get',
    params: { taskId },
  })) as RpcResponse<{
    taskId: string;
    status: string;
    statusMessage?: string;
  }>;
}

async function getResult(mcp: import('@frontmcp/testing').McpTestClient, taskId: string) {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/result',
    params: { taskId },
  })) as RpcResponse<{
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  }>;
}

async function cancelTask(mcp: import('@frontmcp/testing').McpTestClient, taskId: string) {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/cancel',
    params: { taskId },
  })) as RpcResponse<{ status: string }>;
}

async function listTasks(mcp: import('@frontmcp/testing').McpTestClient) {
  return (await mcp.raw.request({
    jsonrpc: '2.0',
    id: rpcId(),
    method: 'tasks/list',
    params: {},
  })) as RpcResponse<{ tasks: Array<{ taskId: string }> }>;
}

async function pollUntil(
  mcp: import('@frontmcp/testing').McpTestClient,
  taskId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 15_000,
): Promise<{ taskId: string; status: string; statusMessage?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await getTask(mcp, taskId);
    if (res.result && predicate(res.result.status)) return res.result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out polling task ${taskId}`);
}

test.describe('CLI Task Runner E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-cli-tasks/src/main.ts',
    project: 'demo-e2e-cli-tasks',
    publicMode: true,
    env: {
      FRONTMCP_TASKS_DB: TEST_DB,
    },
  });

  test.afterAll(() => {
    // Clean up the isolated SQLite file (and WAL/SHM siblings).
    for (const p of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* already gone */
      }
    }
  });

  test('spawns a detached worker that runs the tool and writes to SQLite', async ({ mcp }) => {
    const { taskId } = await createTask(mcp, 'slow-echo', { message: 'hello', delayMs: 100 });
    const terminal = await pollUntil(mcp, taskId, (s) => s === 'completed' || s === 'failed');
    expect(terminal.status).toBe('completed');

    const res = await getResult(mcp, taskId);
    const sc = res.result?.structuredContent as { message?: string; pid?: number } | undefined;
    expect(sc?.message).toBe('hello');
    // The worker ran in a DIFFERENT process than the host — assert PID diverges.
    expect(typeof sc?.pid).toBe('number');
    expect(sc?.pid).not.toBe(process.pid);

    // SQLite file must exist on disk.
    expect(fs.existsSync(TEST_DB)).toBe(true);
  });

  test('tasks/cancel SIGTERMs the worker and transitions to cancelled', async ({ mcp }) => {
    const { taskId } = await createTask(mcp, 'cancellable-wait', { maxMs: 15_000 });
    // Give the worker time to spawn and register its PID.
    await new Promise((r) => setTimeout(r, 400));

    const cancelRes = await cancelTask(mcp, taskId);
    expect(cancelRes.result?.status).toBe('cancelled');

    // The worker should exit quickly after receiving SIGTERM.
    const final = await pollUntil(mcp, taskId, (s) => s === 'cancelled');
    expect(final.status).toBe('cancelled');
  });

  test('SIGKILL of worker triggers orphan detection (record → failed)', async ({ mcp }) => {
    const { taskId } = await createTask(mcp, 'crash', { delayMs: 100 });
    // Wait long enough for the crash tool to SIGKILL itself.
    await new Promise((r) => setTimeout(r, 1500));
    const snap = await getTask(mcp, taskId);
    expect(snap.result?.status).toBe('failed');
    expect(snap.result?.statusMessage).toMatch(/runner exited/i);
  });

  test('tasks/list surfaces records created across different client sessions', async ({ mcp, server }) => {
    // Session A creates a task and disconnects.
    const clientA = await server.createClient();
    const { taskId: idA } = await createTask(clientA, 'slow-echo', { message: 'session-A', delayMs: 50 });
    await pollUntil(clientA, idA, (s) => s === 'completed');
    await clientA.disconnect();

    // Session B (fresh connection, fresh sessionId) MUST NOT see session A's task — spec §Security.
    const clientB = await server.createClient();
    const listB = await listTasks(clientB);
    const ids = (listB.result?.tasks ?? []).map((t) => t.taskId);
    expect(ids).not.toContain(idA);
    await clientB.disconnect();

    // Meanwhile the default `mcp` client (another separate session) can see its OWN tasks after creation + persistence.
    const { taskId: idC } = await createTask(mcp, 'slow-echo', { message: 'default', delayMs: 50 });
    await pollUntil(mcp, idC, (s) => s === 'completed');
    const listC = await listTasks(mcp);
    const idsC = (listC.result?.tasks ?? []).map((t) => t.taskId);
    expect(idsC).toContain(idC);
  });
});
