/**
 * E2E: detached job runs (proposal 2.2 b). A job on the detached runner runs in a process of its own and keeps
 * its run in the server's SQLite store: it finishes after the server that started it was killed, a new server
 * instance reads and cancels it (the runner sees the cancel and runs the job's cleanup), and a run whose runner
 * died is marked `interrupted` by the next server to boot, which runs the cleanup itself. A job on the worker
 * runner runs in a worker thread of the server.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { pathJoin } from '@frontmcp/utils';

interface RunHandle {
  runId: string;
  state: string;
  uri: string;
}

interface RunStatus {
  runId: string;
  state: string;
  result?: Record<string, unknown>;
  error?: { name: string; message: string };
}

const SERVER = 'npx tsx apps/e2e/demo-e2e-jobs/src/main.detached.ts';

let dir: string;
let env: Record<string, string>;
const servers: TestServer[] = [];
const clients: McpTestClient[] = [];

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function startServer(): Promise<{ server: TestServer; mcp: McpTestClient }> {
  const server = await TestServer.start({ command: SERVER, project: 'demo-e2e-jobs', env, startupTimeout: 60_000 });
  servers.push(server);
  const mcp = await McpTestClient.create({
    baseUrl: server.info.baseUrl,
    transport: 'streamable-http',
  }).buildAndConnect();
  clients.push(mcp);
  return { server, mcp };
}

/** Kill the server process outright, as a crash would, then let the harness release its port. */
async function killServer(server: TestServer): Promise<void> {
  const pid = server.info.pid;
  if (pid !== undefined) process.kill(pid, 'SIGKILL');
  await server.stop();
}

function events(): string[] {
  const file = env['JOBS_EVENTS_PATH'];
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

/** The pid that wrote `<tag>:<event>:<pid>`, once it is there. */
async function pidOf(tag: string, event: string): Promise<number> {
  const prefix = `${tag}:${event}:`;
  const line = await until(
    async () => events().find((entry) => entry.startsWith(prefix)),
    (found) => found !== undefined,
    `${prefix} in the events`,
  );
  return Number(String(line).slice(prefix.length));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function start(mcp: McpTestClient, name: string, input: Record<string, unknown>): Promise<RunHandle> {
  const result = await mcp.tools.call('execute_job', { name, input, background: true });
  expect(result).toBeSuccessful();
  return result.json<RunHandle>();
}

async function status(mcp: McpTestClient, runId: string): Promise<RunStatus> {
  return (await mcp.tools.call('get_job_status', { runId })).json<RunStatus>();
}

async function settled(mcp: McpTestClient, runId: string): Promise<RunStatus> {
  return until(
    () => status(mcp, runId),
    (run) => !['pending', 'running', 'retrying'].includes(run.state),
    `run ${runId} to settle`,
  );
}

describe('Detached jobs E2E', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(pathJoin(os.tmpdir(), 'frontmcp-e2e-detached-'));
    env = { JOBS_SQLITE_PATH: pathJoin(dir, 'jobs.sqlite'), JOBS_EVENTS_PATH: pathJoin(dir, 'events.log') };
  });

  afterEach(async () => {
    for (const mcp of clients.splice(0)) await mcp.disconnect().catch(() => undefined);
    for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
    for (const entry of events()) {
      const pid = Number(entry.split(':').pop());
      if (pid !== process.pid && isRunning(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finishes a run after the server that started it was killed, and a new instance reads it', async () => {
    const first = await startServer();
    const handle = await start(first.mcp, 'slow-count', { tag: 'count', steps: 20, stepMs: 200 });
    expect(handle).toEqual({ runId: expect.any(String), state: 'pending', uri: `job://runs/${handle.runId}` });
    const runnerPid = await pidOf('count', 'started');
    expect(runnerPid).not.toBe(first.server.info.pid);
    await until(
      () => status(first.mcp, handle.runId),
      (run) => run.state === 'running',
      'the run to start',
    );

    await killServer(first.server);
    expect(isRunning(runnerPid)).toBe(true);

    const second = await startServer();
    const read = await second.mcp.resources.read(handle.uri);
    expect(read).toBeSuccessful();
    const finished = await settled(second.mcp, handle.runId);
    expect(finished).toEqual(expect.objectContaining({ state: 'completed', result: { counted: 20, pid: runnerPid } }));
    await until(
      async () => isRunning(runnerPid),
      (running) => !running,
      'the runner to exit',
    );
  }, 180_000);

  it('lets a new instance cancel a run another one started; the runner runs the cleanup', async () => {
    const first = await startServer();
    const handle = await start(first.mcp, 'wait-for-cancel', { tag: 'cancel' });
    const runnerPid = await pidOf('cancel', 'started');
    await first.server.stop();

    const second = await startServer();
    const cancelled = await second.mcp.tools.call('cancel_job', { runId: handle.runId });

    expect(cancelled).toBeSuccessful();
    expect(cancelled.json()).toEqual({ runId: handle.runId, state: 'cancelled' });
    expect(await pidOf('cancel', 'cleanup:cancel')).toBe(runnerPid);
    expect((await settled(second.mcp, handle.runId)).state).toBe('cancelled');
    await until(
      async () => isRunning(runnerPid),
      (running) => !running,
      'the runner to exit',
    );
  }, 180_000);

  it('marks a run whose runner died interrupted when the next server boots, and runs its cleanup there', async () => {
    const first = await startServer();
    const handle = await start(first.mcp, 'wait-for-cancel', { tag: 'orphan' });
    const runnerPid = await pidOf('orphan', 'started');
    await first.server.stop();
    process.kill(runnerPid, 'SIGKILL');
    await until(
      async () => isRunning(runnerPid),
      (running) => !running,
      'the runner to die',
    );

    const second = await startServer();
    const ended = await settled(second.mcp, handle.runId);

    expect(ended).toEqual(
      expect.objectContaining({
        state: 'interrupted',
        error: expect.objectContaining({ message: expect.stringContaining('its runner is gone') }),
      }),
    );
    expect(await pidOf('orphan', 'cleanup:interrupt')).toBe(second.server.info.pid);
  }, 180_000);

  it('runs a job on the worker runner in a worker thread of the server', async () => {
    const { mcp, server } = await startServer();

    const result = await mcp.tools.call('execute_job', { name: 'crunch-in-worker', input: { n: 21 } });

    expect(result).toBeSuccessful();
    expect(result.json<{ state: string; result: Record<string, unknown> }>()).toEqual(
      expect.objectContaining({
        state: 'completed',
        result: { doubled: 42, isMainThread: false, pid: server.info.pid },
      }),
    );
  }, 120_000);
});
