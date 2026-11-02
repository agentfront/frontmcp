/**
 * Detached job runs (proposal 2.2 b): a run that lives in a process of its own, keeps its state in the job
 * store, survives the server that started it, and is read, cancelled and reconciled by any server on that store.
 * The runner's entry runs in this process here, as the second instance a spawned runner would boot.
 */
import 'reflect-metadata';

import { spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { z } from '@frontmcp/lazy-zod';

import { completionEventsOf } from '../../channel/sources/completion-events';
import { type JobCompletionEvent } from '../../channel/sources/job-completion.source';
import { App, Job, JobContext, LogLevel, type JobPermission } from '../../common';
import { type DirectAuthContext, type DirectMcpServer } from '../../direct/direct.types';
import { JobRunnerUnavailableError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import { runDetachedJob } from '../runner/detached-job.worker';
import { type JobRunRecord, type JobStateStore } from '../store/job-state.interface';
import { StorageJobStateStore } from '../store/storage-job-state.store';

const events: string[] = [];
let openGate: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();

function closeGate(): void {
  gate = new Promise((resolve) => {
    openGate = resolve;
  });
}

const OPEN: JobPermission[] = [{ action: 'read' }, { action: 'delete' }];

@Job({
  name: 'count_job',
  inputSchema: { to: z.number() },
  outputSchema: { counted: z.number() },
  runner: 'detached',
  timeout: 0,
  permissions: OPEN,
})
class CountJob extends JobContext {
  async execute({ to }: { to: number }) {
    for (let step = 1; step <= to; step++) await this.progress(step, to, `step ${step}`);
    await gate;
    return { counted: to };
  }
}

@Job({
  name: 'wait_job',
  inputSchema: { tag: z.string() },
  outputSchema: {},
  runner: 'detached',
  timeout: 0,
  permissions: OPEN,
  cleanup: (job, reason) => {
    events.push(`${(job.input as { tag: string }).tag}:cleanup:${reason}`);
  },
})
class WaitJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    events.push(`${tag}:started`);
    await new Promise((resolve) => this.signal?.addEventListener('abort', resolve, { once: true }));
    return {};
  }
}

@App({ id: 'detached', name: 'Detached', jobs: [CountJob, WaitJob] })
class DetachedApp {}

const alice: DirectAuthContext = { sessionId: 'alice-session', user: { sub: 'alice' } };
const bob: DirectAuthContext = { sessionId: 'bob-session', user: { sub: 'bob' } };

let dir: string;
let dbPath: string;
const workers: Promise<number>[] = [];
const servers: DirectMcpServer[] = [];

function config() {
  return {
    info: { name: 'detached-jobs', version: '1.0.0' },
    apps: [DetachedApp],
    logging: { level: LogLevel.Off },
    sqlite: { path: dbPath },
  };
}

async function open(): Promise<DirectMcpServer> {
  const server = await FrontMcpInstance.createDirect(config());
  servers.push(server);
  return server;
}

function scopeOf(server: DirectMcpServer): Scope {
  return (server as unknown as { scope: Scope }).scope;
}

function managerOf(server: DirectMcpServer): JobExecutionManager {
  const manager = (scopeOf(server) as unknown as { _jobExecutionManager?: JobExecutionManager })._jobExecutionManager;
  if (!manager) throw new Error('jobs are not enabled');
  return manager;
}

function storeOf(server: DirectMcpServer): JobStateStore {
  const store = (scopeOf(server) as unknown as { _jobStateStore?: JobStateStore })._jobStateStore;
  if (!store) throw new Error('jobs are not enabled');
  return store;
}

function jobOf(server: DirectMcpServer, name: string) {
  const job = scopeOf(server).jobs?.findByName(name);
  if (!job) throw new Error(`${name} is not registered`);
  return job;
}

/** A manager on the server's scope whose detached runs start the runner's entry in this process. */
function starterOn(server: DirectMcpServer): JobExecutionManager {
  const scope = scopeOf(server);
  return new JobExecutionManager(storeOf(server), scope.logger, undefined, scope, {
    findJob: (name) => scope.jobs?.findByName(name),
    spawnDetached: (runId) => {
      workers.push(runDetachedJob(config(), runId));
      return { pid: process.pid, once: () => undefined };
    },
  });
}

async function startDetached(server: DirectMcpServer, name: string, input: Record<string, unknown>) {
  const starter = starterOn(server);
  const handle = await starter.executeJob(jobOf(server, name), input, {
    sessionId: 'alice-session',
    authInfo: { sessionId: 'alice-session', user: { sub: 'alice' } },
  });
  return { starter, handle };
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function stateOf(server: DirectMcpServer, runId: string): Promise<JobRunRecord | null> {
  return storeOf(server).getRun(runId);
}

function deadPid(): number {
  const exited = spawnSync(process.execPath, ['-e', '']);
  return exited.pid;
}

function orphan(runId: string, scopeId: string, overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    runId,
    jobId: 'wait_job',
    jobName: 'wait_job',
    sessionId: 'alice-session',
    ownerSub: 'alice',
    state: 'running',
    input: { tag: runId },
    startedAt: Date.now(),
    attempt: 1,
    maxAttempts: 1,
    logs: [],
    background: true,
    scopeId,
    runner: { kind: 'detached', id: `runner-${runId}`, pid: deadPid(), hostname: os.hostname() },
    ...overrides,
  };
}

beforeEach(() => {
  events.length = 0;
  gate = Promise.resolve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-detached-jobs-'));
  dbPath = path.join(dir, 'jobs.sqlite');
});

afterEach(async () => {
  openGate();
  await Promise.allSettled(workers.splice(0));
  for (const server of servers.splice(0)) await server.dispose().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a detached run', () => {
  it('answers at once, runs in its runner and lands its result in the store after the starting server is gone', async () => {
    closeGate();
    const first = await open();
    const { starter, handle } = await startDetached(first, 'count_job', { to: 3 });

    expect(handle).toEqual({ runId: expect.any(String), state: 'pending' });
    await waitFor(async () => (await stateOf(first, handle.runId))?.progress?.progress === 3, 'the progress to land');
    expect(await stateOf(first, handle.runId)).toEqual(
      expect.objectContaining({
        state: 'running',
        progress: { progress: 3, total: 3, message: 'step 3' },
        runner: { kind: 'detached', id: expect.any(String), pid: process.pid, hostname: os.hostname() },
      }),
    );

    await starter.dispose();
    await first.dispose();
    openGate();
    expect(await workers[0]).toBe(0);

    const second = await open();
    const status = await second.callTool('get_job_status', { runId: handle.runId }, { authContext: alice });
    expect(status.structuredContent).toEqual(expect.objectContaining({ state: 'completed', result: { counted: 3 } }));
  });

  it('is read and cancelled by a new server instance; its runner sees the cancel and runs the cleanup', async () => {
    const first = await open();
    const { starter, handle } = await startDetached(first, 'wait_job', { tag: 'c1' });
    await waitFor(() => events.includes('c1:started'), 'the job to start');
    await starter.dispose();
    await first.dispose();

    const second = await open();
    const completions: JobCompletionEvent[] = [];
    completionEventsOf(scopeOf(second)).jobs.subscribe((event) => completions.push(event));
    const read = await second.readResource(`job://runs/${handle.runId}`, { authContext: bob });
    expect(JSON.parse(String((read.contents[0] as { text: string }).text))).toEqual(
      expect.objectContaining({ runId: handle.runId, state: 'running' }),
    );

    const cancelled = await second.callTool('cancel_job', { runId: handle.runId }, { authContext: bob });

    expect(cancelled.structuredContent).toEqual({ runId: handle.runId, state: 'cancelled' });
    await waitFor(() => events.includes('c1:cleanup:cancel'), 'the runner to run the cleanup');
    expect(await workers[0]).toBe(0);
    expect((await stateOf(second, handle.runId))?.state).toBe('cancelled');
    await waitFor(() => completions.some((event) => event.status === 'cancelled'), 'the watching server to publish');
  });

  it('writes the progress it reports at most every 500 ms, then its last progress with its outcome', async () => {
    const updates = jest.spyOn(StorageJobStateStore.prototype, 'updateRun');
    try {
      const server = await open();
      const { handle } = await startDetached(server, 'count_job', { to: 200 });
      expect(await workers[0]).toBe(0);

      const progressWrites = updates.mock.calls.filter(([runId, update]) => runId === handle.runId && update.progress);
      expect(progressWrites.length).toBeLessThanOrEqual(2);
      expect(await stateOf(server, handle.runId)).toEqual(
        expect.objectContaining({ state: 'completed', progress: { progress: 200, total: 200, message: 'step 200' } }),
      );
    } finally {
      updates.mockRestore();
    }
  });

  it('fails with JOB_RUNNER_BOOT_FAILED, once, when its process cannot start', async () => {
    const server = await open();
    const scope = scopeOf(server);
    const notify = jest.fn(async (_data: Record<string, unknown>) => undefined);
    const failing = new EventEmitter();
    const starter = new JobExecutionManager(storeOf(server), scope.logger, notify, scope, {
      findJob: (name) => scope.jobs?.findByName(name),
      spawnDetached: () => {
        setImmediate(() => failing.emit('error', new Error('spawn node ENOENT')));
        return failing;
      },
    });
    const handle = await starter.executeJob(jobOf(server, 'count_job'), { to: 1 }, {});

    await waitFor(async () => (await stateOf(server, handle.runId))?.state === 'failed', 'the run to fail');
    expect((await stateOf(server, handle.runId))?.error).toEqual(
      expect.objectContaining({ name: 'JobRunnerBootError', message: expect.stringContaining('spawn node ENOENT') }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await stateOf(server, handle.runId))?.error?.message).toContain('spawn node ENOENT');
    expect(notify.mock.calls.filter(([data]) => data['state'] === 'failed')).toHaveLength(1);
    await starter.dispose();
  });

  it('is refused by an in-process server, which has no entry a runner can run again', async () => {
    const server = await open();

    const refusal = server.callTool('execute_job', { name: 'count_job', input: { to: 1 } }, { authContext: alice });

    await expect(refusal).rejects.toBeInstanceOf(JobRunnerUnavailableError);
    await expect(refusal).rejects.toHaveProperty('remedy.say', expect.stringMatching(/entry/));
  });
});

describe('the detached runner entry', () => {
  it('writes a typed failure to the store when it cannot boot', async () => {
    const server = await open();
    const record = orphan('boot-1', scopeOf(server).id, { state: 'pending' });
    await storeOf(server).createRun(record);

    const code = await runDetachedJob(config(), 'boot-1', async () => {
      throw new Error('the database is down');
    });

    expect(code).toBe(1);
    expect(await stateOf(server, 'boot-1')).toEqual(
      expect.objectContaining({
        state: 'failed',
        error: expect.objectContaining({
          name: 'JobRunnerBootError',
          message: expect.stringContaining('the database is down'),
        }),
      }),
    );
  });

  it('leaves an unknown or finished run alone', async () => {
    const server = await open();
    await storeOf(server).createRun(orphan('done-1', scopeOf(server).id, { state: 'completed' }));

    expect(await runDetachedJob(config(), 'no-such-run')).toBe(0);
    expect(await runDetachedJob(config(), 'done-1')).toBe(0);
    expect((await stateOf(server, 'done-1'))?.state).toBe('completed');
  });

  it('fails a run whose job the server no longer has', async () => {
    const server = await open();
    await storeOf(server).createRun(orphan('gone-1', scopeOf(server).id, { state: 'pending', jobName: 'gone_job' }));

    expect(await runDetachedJob(config(), 'gone-1')).toBe(0);
    expect(await stateOf(server, 'gone-1')).toEqual(
      expect.objectContaining({
        state: 'failed',
        error: expect.objectContaining({ name: 'JobRunnerBootError', message: expect.stringContaining('gone_job') }),
      }),
    );
  });
});

describe('reconcile on boot', () => {
  it('interrupts a run whose runner died and runs its cleanup once, however many servers reconcile it', async () => {
    const first = await open();
    await storeOf(first).createRun(orphan('dead-1', scopeOf(first).id));

    const [second, third] = await Promise.all([open(), open()]);
    await Promise.all([managerOf(first).reconcile(), managerOf(second).reconcile(), managerOf(third).reconcile()]);
    await waitFor(() => events.includes('dead-1:cleanup:interrupt'), 'the cleanup');

    expect(events.filter((event) => event === 'dead-1:cleanup:interrupt')).toHaveLength(1);
    expect(await stateOf(first, 'dead-1')).toEqual(
      expect.objectContaining({
        state: 'interrupted',
        error: expect.objectContaining({
          name: 'JobInterruptedError',
          message: expect.stringMatching(/runner is gone/),
        }),
      }),
    );
  });

  it('fails, without a cleanup, a detached run whose runner never took it over', async () => {
    const first = await open();
    await storeOf(first).createRun(orphan('never-1', scopeOf(first).id, { state: 'pending' }));

    await managerOf(first).reconcile();

    expect(await stateOf(first, 'never-1')).toEqual(
      expect.objectContaining({ state: 'failed', error: expect.objectContaining({ name: 'JobRunnerBootError' }) }),
    );
    expect(events).toEqual([]);
  });

  it("judges another host's runner by its heartbeat, and watches a live detached run until it ends", async () => {
    const first = await open();
    const store = storeOf(first);
    const scopeId = scopeOf(first).id;
    const elsewhere = (id: string) => ({ kind: 'detached' as const, id, pid: 1, hostname: 'another-host' });
    await store.createRun(orphan('remote-gone', scopeId, { runner: elsewhere('lapsed') }));
    await store.createRun(orphan('remote-live', scopeId, { runner: elsewhere('beating') }));
    await store.touchRunner?.('beating', 60);

    const second = await open();
    const completions: JobCompletionEvent[] = [];
    completionEventsOf(scopeOf(second)).jobs.subscribe((event) => completions.push(event));
    await managerOf(second).reconcile();

    await waitFor(async () => (await stateOf(second, 'remote-gone'))?.state === 'interrupted', 'the lapsed run');
    expect((await stateOf(second, 'remote-live'))?.state).toBe('running');
    await store.updateRun('remote-live', { state: 'completed', result: {}, completedAt: Date.now() });
    await waitFor(
      () => completions.some((event) => event.status === 'success' && event.jobName === 'wait_job'),
      'the watching server to publish the outcome',
    );
  });

  it('leaves the inline runs of a live server and the runs of an older release alone', async () => {
    const first = await open();
    const store = storeOf(first);
    const scopeId = scopeOf(first).id;
    await store.createRun(
      orphan('inline-live', scopeId, {
        runner: { kind: 'inline', id: 'server-2', pid: process.pid, hostname: os.hostname() },
      }),
    );
    await store.touchRunner?.('server-2', 60);
    await store.createRun(orphan('legacy', scopeId, { runner: undefined }));

    await managerOf(first).reconcile();

    expect((await stateOf(first, 'inline-live'))?.state).toBe('running');
    expect((await stateOf(first, 'legacy'))?.state).toBe('running');
    expect(events).toEqual([]);
  });
});
