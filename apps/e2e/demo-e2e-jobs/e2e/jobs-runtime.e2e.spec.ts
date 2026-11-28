/**
 * E2E: detached workflows, machine-wide admission and runners that boot only their run's app (#1351). A detached
 * workflow runs its steps in a process of its own, and a server that did not start it cancels it; two servers on one
 * job store run their detached jobs one at a time on the machine; a runner with `jobs.detached.boot: 'app'` boots only
 * the app its run needs.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { pathJoin } from '@frontmcp/utils';

interface RunHandle {
  runId: string;
  state: string;
}

interface RunStatus {
  runId: string;
  state: string;
}

/** One line the fixture wrote: `<tag> <event> <ms> <pid>`. */
interface RunEvent {
  tag: string;
  event: string;
  at: number;
  pid: number;
}

const SERVER = 'npx tsx apps/e2e/demo-e2e-jobs/src/main.runtime.ts';

let dir: string;
let env: Record<string, string>;
const servers: TestServer[] = [];
const clients: McpTestClient[] = [];

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function startServer(extra: Record<string, string> = {}): Promise<{ server: TestServer; mcp: McpTestClient }> {
  const server = await TestServer.start({
    command: SERVER,
    project: 'demo-e2e-jobs',
    env: { ...env, ...extra },
    startupTimeout: 60_000,
  });
  servers.push(server);
  const mcp = await McpTestClient.create({
    baseUrl: server.info.baseUrl,
    transport: 'streamable-http',
  }).buildAndConnect();
  clients.push(mcp);
  return { server, mcp };
}

function events(): RunEvent[] {
  const file = env['JOBS_EVENTS_PATH'];
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tag, event, at, pid] = line.split(' ');
      return { tag, event, at: Number(at), pid: Number(pid) };
    });
}

async function eventOf(tag: string, event: string): Promise<RunEvent> {
  const found = await until(
    async () => events().find((entry) => entry.tag === tag && entry.event === event),
    (entry) => entry !== undefined,
    `${tag} ${event} in the events`,
  );
  if (!found) throw new Error(`no ${tag} ${event}`);
  return found;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function call<T>(mcp: McpTestClient, tool: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcp.tools.call(tool, args);
  expect(result).toBeSuccessful();
  return result.json<T>();
}

async function settled(mcp: McpTestClient, tool: string, runId: string): Promise<RunStatus> {
  return until(
    () => call<RunStatus>(mcp, tool, { runId }),
    (run) => !['pending', 'running', 'retrying'].includes(run.state),
    `run ${runId} to settle`,
  );
}

describe('Job runtime E2E', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(pathJoin(os.tmpdir(), 'frontmcp-e2e-job-runtime-'));
    env = { JOBS_SQLITE_PATH: pathJoin(dir, 'jobs.sqlite'), JOBS_EVENTS_PATH: pathJoin(dir, 'events.log') };
  });

  afterEach(async () => {
    for (const mcp of clients.splice(0)) await mcp.disconnect().catch(() => undefined);
    for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
    for (const { pid } of events()) {
      if (pid !== process.pid && isRunning(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs a detached workflow's steps in a process of its own", async () => {
    const { mcp } = await startServer();
    const serverPid = (await eventOf('runtime', 'booted')).pid;

    const handle = await call<RunHandle>(mcp, 'execute_workflow', { name: 'detached-notes', input: { tag: 'notes' } });

    expect(handle).toEqual({ runId: expect.any(String), state: 'pending' });
    expect((await settled(mcp, 'get_workflow_status', handle.runId)).state).toBe('completed');
    const first = await eventOf('notes-first', 'step');
    const second = await eventOf('notes-second', 'step');
    expect(second.pid).toBe(first.pid);
    expect([serverPid, process.pid]).not.toContain(first.pid);
  }, 180_000);

  it('is cancelled by a server that did not start it: the runner aborts the step and starts no other', async () => {
    const first = await startServer();
    const handle = await call<RunHandle>(first.mcp, 'execute_workflow', {
      name: 'detached-wait',
      input: { tag: 'wait' },
    });
    const waiting = await eventOf('wait', 'waiting');
    await first.server.stop();

    const second = await startServer();
    expect(await call(second.mcp, 'cancel_job', { runId: handle.runId })).toEqual({
      runId: handle.runId,
      state: 'cancelled',
    });

    expect((await eventOf('wait', 'aborted')).pid).toBe(waiting.pid);
    expect((await settled(second.mcp, 'get_workflow_status', handle.runId)).state).toBe('cancelled');
    await until(
      async () => isRunning(waiting.pid),
      (running) => !running,
      'the runner to exit',
    );
    expect(events().some(({ tag }) => tag === 'wait-after')).toBe(false);
  }, 180_000);

  it('runs the detached jobs of two servers on one store one at a time on the machine', async () => {
    const [left, right] = [await startServer(), await startServer()];
    const tags = ['l1', 'r1', 'l2', 'r2'];

    const handles = await Promise.all(
      tags.map((tag) =>
        call<RunHandle>(tag.startsWith('l') ? left.mcp : right.mcp, 'execute_job', {
          name: 'hold-slot',
          input: { tag, holdMs: 1_000 },
          background: true,
        }),
      ),
    );
    for (const [index, handle] of handles.entries()) {
      const mcp = tags[index].startsWith('l') ? left.mcp : right.mcp;
      expect((await settled(mcp, 'get_job_status', handle.runId)).state).toBe('completed');
    }

    const spans = tags
      .map((tag) => ({
        start: events().find((entry) => entry.tag === tag && entry.event === 'start'),
        end: events().find((entry) => entry.tag === tag && entry.event === 'end'),
      }))
      .map(({ start, end }) => ({ start: start?.at ?? 0, end: end?.at ?? 0, pid: start?.pid ?? 0 }))
      .sort((a, b) => a.start - b.start);
    expect(new Set(spans.map(({ pid }) => pid)).size).toBe(4);
    for (let index = 1; index < spans.length; index++) {
      expect(spans[index].start).toBeGreaterThanOrEqual(spans[index - 1].end);
    }
  }, 240_000);

  it("boots only the run's app in a runner with jobs.detached.boot 'app'", async () => {
    const { mcp } = await startServer({ JOBS_DETACHED_BOOT: 'app' });
    const serverPid = (await eventOf('marker', 'booted')).pid;

    const handle = await call<RunHandle>(mcp, 'execute_job', {
      name: 'hold-slot',
      input: { tag: 'only', holdMs: 0 },
      background: true,
    });
    expect((await settled(mcp, 'get_job_status', handle.runId)).state).toBe('completed');

    const runner = (await eventOf('only', 'start')).pid;
    const booted = (pid: number) =>
      events()
        .filter((entry) => entry.event === 'booted' && entry.pid === pid)
        .map(({ tag }) => tag)
        .sort();
    expect(booted(serverPid)).toEqual(['marker', 'runtime']);
    expect(booted(runner)).toEqual(['runtime']);
  }, 180_000);
});
