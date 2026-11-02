/**
 * Durable jobs (proposal 2.2 a): a run can be cancelled through the store, an attempt ends at its
 * timeout, `@Job({ cleanup })` runs when an attempt is interrupted, timed out or cancelled, admission
 * bounds how many attempts run at once, and `job://runs/{runId}` shows a run and its progress.
 */
import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { z } from '@frontmcp/lazy-zod';

import { completionEventsOf } from '../../channel/sources/completion-events';
import { type JobCompletionEvent } from '../../channel/sources/job-completion.source';
import {
  App,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Workflow,
  type JobCleanup,
  type LogRecord,
} from '../../common';
import { type DirectAuthContext, type DirectMcpServer } from '../../direct/direct.types';
import {
  JobAdmissionTimeoutError,
  JobCancelledError,
  JobRunFinishedError,
  JobRunNotCancellableError,
  JobRunNotFoundError,
  JobTimeoutError,
  ResourceNotFoundError,
} from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import { type JobRunRecord, type JobStateStore, type WorkflowRunRecord } from '../store/job-state.interface';
import { MemoryJobStateStore } from '../store/memory-job-state.store';

const entered: string[] = [];
const cleanups: string[] = [];
let openGate: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();

function closeGate(): void {
  gate = new Promise((resolve) => {
    openGate = resolve;
  });
}

const recordCleanup: JobCleanup = (job, reason) => {
  cleanups.push(`${(job.input as { tag: string }).tag}:${reason}`);
};

const tagged = { tag: z.string() };

@Job({ name: 'hang_job', inputSchema: tagged, outputSchema: {}, timeout: 0, cleanup: recordCleanup })
class HangJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    return new Promise(() => undefined);
  }
}

@Job({ name: 'default_timeout_job', inputSchema: tagged, outputSchema: {}, cleanup: recordCleanup })
class DefaultTimeoutJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'retry_timeout_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 30,
  retry: { maxAttempts: 2, backoffMs: 1 },
  cleanup: recordCleanup,
})
class RetryTimeoutJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(`${tag}:${this.attempt}`);
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'signal_job',
  inputSchema: tagged,
  outputSchema: { aborted: z.boolean() },
  timeout: 30,
})
class SignalJob extends JobContext {
  async execute({ tag }: { tag: string }) {
    entered.push(tag);
    await new Promise((resolve) => this.signal?.addEventListener('abort', resolve, { once: true }));
    cleanups.push(`${tag}:reason=${(this.signal?.reason as Error).name}`);
    return { aborted: true };
  }
}

@Job({
  name: 'failing_cleanup_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 30,
  cleanup: () => {
    throw new Error('the cleanup broke');
  },
})
class FailingCleanupJob extends JobContext {
  async execute(_input: { tag: string }): Promise<Record<string, never>> {
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'stuck_cleanup_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 30,
  cleanup: { run: () => new Promise<void>(() => undefined), timeoutMs: 20 },
})
class StuckCleanupJob extends JobContext {
  async execute(_input: { tag: string }): Promise<Record<string, never>> {
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'slow_retry_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 0,
  retry: { maxAttempts: 2, backoffMs: 60_000 },
})
class SlowRetryJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(`${tag}:${this.attempt}`);
    throw new Error('the first attempt fails');
  }
}

@Job({ name: 'quick_job', inputSchema: tagged, outputSchema: { ok: z.boolean() }, cleanup: recordCleanup })
class QuickJob extends JobContext {
  async execute(_input: { tag: string }) {
    return { ok: true };
  }
}

@Job({ name: 'progress_job', inputSchema: {}, outputSchema: { steps: z.number() }, timeout: 0 })
class ProgressJob extends JobContext {
  async execute() {
    await gate;
    for (let step = 1; step <= 3; step++) await this.progress(step, 3, `step ${step}`);
    return { steps: 3 };
  }
}

@Job({
  name: 'guarded_hang_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 0,
  permissions: [
    { action: 'read', roles: ['ops'] },
    { action: 'delete', roles: ['ops'] },
  ],
})
class GuardedHangJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    return new Promise(() => undefined);
  }
}

let openFailGate: () => void = () => undefined;
let failGate: Promise<void> = Promise.resolve();

@Job({ name: 'gated_fail_job', inputSchema: tagged, outputSchema: {}, timeout: 0 })
class GatedFailJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    await failGate;
    throw new Error('the job failed on its own');
  }
}

@Job({ name: 'boom_job', inputSchema: tagged, outputSchema: {}, timeout: 0 })
class BoomJob extends JobContext {
  async execute(_input: { tag: string }): Promise<Record<string, never>> {
    throw new Error('boom');
  }
}

@Job({ name: 'parting_progress_job', inputSchema: {}, outputSchema: { ok: z.boolean() }, timeout: 0 })
class PartingProgressJob extends JobContext {
  async execute() {
    void this.progress(1, 1, 'last words');
    return { ok: true };
  }
}

let chatter = false;

@Job({ name: 'chatty_hang_job', inputSchema: tagged, outputSchema: {}, timeout: 30 })
class ChattyHangJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    for (let step = 1; chatter; step++) {
      await this.progress(step, undefined, `still going ${step}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return {};
  }
}

@Job({
  name: 'slow_cleanup_hang_job',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 0,
  cleanup: { run: () => new Promise<void>(() => undefined), timeoutMs: 60_000 },
})
class SlowCleanupHangJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    entered.push(tag);
    return new Promise(() => undefined);
  }
}

@Workflow({ name: 'gated_flow', steps: [{ id: 'wait', jobName: 'progress_job', timeout: 60_000 }] })
class GatedFlow {}

@App({
  id: 'durable',
  name: 'Durable',
  workflows: [GatedFlow],
  jobs: [
    HangJob,
    DefaultTimeoutJob,
    RetryTimeoutJob,
    SignalJob,
    FailingCleanupJob,
    StuckCleanupJob,
    QuickJob,
    SlowRetryJob,
    ProgressJob,
    GuardedHangJob,
    GatedFailJob,
    BoomJob,
    PartingProgressJob,
    ChattyHangJob,
    SlowCleanupHangJob,
  ],
})
class DurableApp {}

const alice: DirectAuthContext = { sessionId: 'alice-session', user: { sub: 'alice' } };
const bob: DirectAuthContext = { sessionId: 'bob-session', user: { sub: 'bob' } };
const operator: DirectAuthContext = { sessionId: 'ops-session', user: { sub: 'olga', roles: ['ops'] } };

interface StartedRun {
  runId: string;
  state: string;
  uri: string;
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function scopeOf(server: DirectMcpServer): Scope {
  return (server as unknown as { scope: Scope }).scope;
}

function managerOf(server: DirectMcpServer): JobExecutionManager {
  const manager = (scopeOf(server) as unknown as { _jobExecutionManager?: JobExecutionManager })._jobExecutionManager;
  if (!manager) throw new Error('jobs are not enabled');
  return manager;
}

function jobOf(server: DirectMcpServer, name: string) {
  const job = scopeOf(server).jobs?.findByName(name);
  if (!job) throw new Error(`${name} is not registered`);
  return job;
}

/** A store whose progress writes read the run, wait, then write it back whole, as a slow read-modify-write does. */
class SlowProgressStore extends MemoryJobStateStore {
  override async updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    if (!('progress' in updates)) return super.updateRun(runId, updates);
    const before = await this.getRun(runId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (before) await super.updateRun(runId, { ...before, ...updates });
  }
}

/** A JobStateStore written before cancel requests existed: it has none of their methods. */
function withoutCancelRequests(store: MemoryJobStateStore): JobStateStore {
  return {
    createRun: (record) => store.createRun(record),
    updateRun: (runId, updates) => store.updateRun(runId, updates),
    getRun: (runId) => store.getRun(runId),
    listRuns: (opts) => store.listRuns(opts),
    cleanup: (olderThanMs) => store.cleanup(olderThanMs),
    dispose: () => store.dispose(),
  };
}

async function startRun(
  server: DirectMcpServer,
  name: string,
  input: Record<string, unknown>,
  authContext: DirectAuthContext = alice,
): Promise<StartedRun> {
  const response = await server.callTool('execute_job', { name, input, background: true }, { authContext });
  return response.structuredContent as unknown as StartedRun;
}

async function finished(server: DirectMcpServer, runId: string): Promise<JobRunRecord> {
  const manager = managerOf(server);
  let record: JobRunRecord | null = null;
  await waitFor(async () => {
    record = await manager.getStatus(runId);
    return !!record && !['pending', 'running', 'retrying'].includes(record.state);
  }, `run ${runId} to finish`);
  if (!record) throw new Error(`run ${runId} vanished`);
  return record;
}

beforeEach(() => {
  entered.length = 0;
  cleanups.length = 0;
});

describe('durable jobs', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-jobs', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true, defaultTimeoutMs: 50 },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  describe('run handle', () => {
    it('answers a background run at once with its job://runs uri', async () => {
      closeGate();
      const started = await startRun(server, 'progress_job', {});

      expect(started).toEqual({ runId: expect.any(String), state: 'pending', uri: `job://runs/${started.runId}` });
      openGate();
      await finished(server, started.runId);
    });

    it('gives an inline run its uri too', async () => {
      const response = await server.callTool('execute_job', { name: 'quick_job', input: { tag: 'q' } });
      const run = response.structuredContent as unknown as StartedRun;

      expect(run).toEqual(expect.objectContaining({ state: 'completed', uri: `job://runs/${run.runId}` }));
    });
  });

  describe('cancel_job', () => {
    it('writes the cancel to the store, aborts the run and runs its cleanup', async () => {
      const started = await startRun(server, 'hang_job', { tag: 'c1' });
      await waitFor(() => entered.includes('c1'), 'the job to start');

      const response = await server.callTool('cancel_job', { runId: started.runId }, { authContext: alice });

      expect(response.structuredContent).toEqual({ runId: started.runId, state: 'cancelled' });
      const run = await finished(server, started.runId);
      expect(run).toEqual(
        expect.objectContaining({ state: 'cancelled', error: expect.objectContaining({ name: 'JobCancelledError' }) }),
      );
      await waitFor(() => cleanups.includes('c1:cancel'), 'the cleanup');
    });

    it('never starts a run cancelled before it started', async () => {
      const manager = managerOf(server);
      const scope = (server as unknown as { scope: Scope }).scope;
      const job = scope.jobs?.findByName('hang_job');
      if (!job) throw new Error('hang_job is not registered');

      const started = await manager.executeJob(job, { tag: 'c0' }, { background: true });
      await manager.cancel(started.runId);

      expect((await finished(server, started.runId)).state).toBe('cancelled');
      expect(entered).not.toContain('c0');
    });

    it('cancels a run waiting out its retry backoff without starting another attempt', async () => {
      const started = await startRun(server, 'slow_retry_job', { tag: 'c5' });
      await waitFor(async () => (await managerOf(server).getStatus(started.runId))?.state === 'retrying', 'the retry');

      await server.callTool('cancel_job', { runId: started.runId }, { authContext: alice });

      expect(await finished(server, started.runId)).toEqual(
        expect.objectContaining({ state: 'cancelled', attempt: 1 }),
      );
      expect(entered).toEqual(['c5:1']);
    });

    it('refuses a finished run with a remedy that reads its outcome', async () => {
      const response = await server.callTool(
        'execute_job',
        { name: 'quick_job', input: { tag: 'f' } },
        { authContext: alice },
      );
      const { runId } = response.structuredContent as unknown as StartedRun;

      const refusal = server.callTool('cancel_job', { runId }, { authContext: alice });

      await expect(refusal).rejects.toBeInstanceOf(JobRunFinishedError);
      await expect(refusal).rejects.toMatchObject({
        code: 'JOB_RUN_FINISHED',
        remedy: { tool: 'get_job_status', args: { runId } },
      });
    });

    it('refuses an unknown run with a remedy', async () => {
      const refusal = server.callTool('cancel_job', { runId: 'no-such-run' }, { authContext: alice });

      await expect(refusal).rejects.toBeInstanceOf(JobRunNotFoundError);
      await expect(refusal).rejects.toMatchObject({ code: 'JOB_RUN_NOT_FOUND', remedy: { say: expect.any(String) } });
    });

    it("answers another caller's run as unknown, and leaves it running", async () => {
      const started = await startRun(server, 'hang_job', { tag: 'c2' });
      await waitFor(() => entered.includes('c2'), 'the job to start');

      await expect(
        server.callTool('cancel_job', { runId: started.runId }, { authContext: bob }),
      ).rejects.toBeInstanceOf(JobRunNotFoundError);
      expect((await managerOf(server).getStatus(started.runId))?.state).toBe('running');

      await server.callTool('cancel_job', { runId: started.runId }, { authContext: alice });
      await finished(server, started.runId);
    });

    it("lets a caller who passes the job's delete rule cancel another caller's run", async () => {
      const started = await startRun(server, 'guarded_hang_job', { tag: 'c3' });
      await waitFor(() => entered.includes('c3'), 'the job to start');

      const response = await server.callTool('cancel_job', { runId: started.runId }, { authContext: operator });

      expect(response.structuredContent).toEqual({ runId: started.runId, state: 'cancelled' });
      expect((await finished(server, started.runId)).state).toBe('cancelled');
    });

    it('fails an inline run that is cancelled with JobCancelledError', async () => {
      const inline = server.callTool('execute_job', { name: 'hang_job', input: { tag: 'c4' } }, { authContext: alice });
      await waitFor(() => entered.includes('c4'), 'the job to start');
      const [run] = await managerOf(server).listRuns({ sessionId: 'alice-session', state: 'running' });

      await server.callTool('cancel_job', { runId: run.runId }, { authContext: alice });

      await expect(inline).rejects.toBeInstanceOf(JobCancelledError);
    });

    it('cancels a run on a store that keeps no cancel requests of its own', async () => {
      const store = new MemoryJobStateStore();
      const scope = scopeOf(server);
      const manager = new JobExecutionManager(withoutCancelRequests(store), scope.logger, undefined, scope);
      const started = await manager.executeJob(jobOf(server, 'hang_job'), { tag: 'c6' }, { background: true });
      await waitFor(() => entered.includes('c6'), 'the job to start');

      await manager.cancel(started.runId);

      await waitFor(() => cleanups.includes('c6:cancel'), 'the cleanup');
      expect((await store.getRun(started.runId))?.state).toBe('cancelled');
    });

    it('refuses to cancel a workflow run', async () => {
      closeGate();
      const response = await server.callTool(
        'execute_workflow',
        { name: 'gated_flow', background: true },
        { authContext: alice },
      );
      const { runId } = response.structuredContent as unknown as StartedRun;

      await expect(server.callTool('cancel_job', { runId }, { authContext: alice })).rejects.toBeInstanceOf(
        JobRunNotCancellableError,
      );
      openGate();
      await finished(server, runId);
    });
  });

  describe('timeouts', () => {
    it("ends a run whose attempt outlasts the job's timeout as timed_out, after its cleanup", async () => {
      const started = await startRun(server, 'retry_timeout_job', { tag: 't1' });

      const run = await finished(server, started.runId);

      expect(run).toEqual(
        expect.objectContaining({
          state: 'timed_out',
          attempt: 2,
          error: expect.objectContaining({ name: 'JobTimeoutError' }),
        }),
      );
      expect(entered).toEqual(['t1:1', 't1:2']);
      expect(cleanups).toEqual(['t1:timeout', 't1:timeout']);
    });

    it('applies jobs.defaultTimeoutMs to a job that sets no timeout', async () => {
      const inline = server.callTool('execute_job', { name: 'default_timeout_job', input: { tag: 't2' } });

      await expect(inline).rejects.toBeInstanceOf(JobTimeoutError);
      expect(cleanups).toEqual(['t2:timeout']);
    });

    it("aborts the job's this.signal with the timeout", async () => {
      const started = await startRun(server, 'signal_job', { tag: 't3' });

      expect((await finished(server, started.runId)).state).toBe('timed_out');
      await waitFor(() => cleanups.includes('t3:reason=JobTimeoutError'), 'the job to see its signal');
    });

    it('never runs the cleanup of an attempt that ends on its own', async () => {
      await server.callTool('execute_job', { name: 'quick_job', input: { tag: 't4' } });

      expect(cleanups).toEqual([]);
    });

    it('still ends the run when its cleanup throws or outlasts its own bound', async () => {
      const failing = await startRun(server, 'failing_cleanup_job', { tag: 't5' });
      const stuck = await startRun(server, 'stuck_cleanup_job', { tag: 't6' });

      expect((await finished(server, failing.runId)).state).toBe('timed_out');
      expect((await finished(server, stuck.runId)).state).toBe('timed_out');
    });
  });

  describe('writes to a run', () => {
    it('keeps the final state when a progress write the job did not wait for is still in flight', async () => {
      const store = new SlowProgressStore();
      const scope = scopeOf(server);
      const manager = new JobExecutionManager(store, scope.logger, undefined, scope);

      const { runId } = await manager.executeJob(jobOf(server, 'parting_progress_job'), {});
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(await store.getRun(runId)).toEqual(
        expect.objectContaining({ state: 'completed', progress: { progress: 1, total: 1, message: 'last words' } }),
      );
    });

    it('drops what an attempt reports after it was aborted', async () => {
      chatter = true;
      try {
        const started = await startRun(server, 'chatty_hang_job', { tag: 'p1' });
        const run = await finished(server, started.runId);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(await managerOf(server).getStatus(started.runId)).toEqual(
          expect.objectContaining({ state: 'timed_out', revision: run.revision }),
        );
      } finally {
        chatter = false;
      }
    });

    it('publishes a run that timed out or was cancelled as a job completion', async () => {
      const events: JobCompletionEvent[] = [];
      const unsubscribe = completionEventsOf(scopeOf(server)).jobs.subscribe((event) => events.push(event));
      try {
        const timedOut = await startRun(server, 'signal_job', { tag: 'e1' });
        await finished(server, timedOut.runId);
        const cancelled = await startRun(server, 'hang_job', { tag: 'e2' });
        await waitFor(() => entered.includes('e2'), 'the job to start');
        await server.callTool('cancel_job', { runId: cancelled.runId }, { authContext: alice });
        await waitFor(() => events.length >= 2, 'the completions');

        expect(events.map((event) => [event.jobName, event.status])).toEqual([
          ['signal_job', 'timeout'],
          ['hang_job', 'cancelled'],
        ]);
      } finally {
        unsubscribe();
      }
    });
  });

  describe('job://runs/{runId}', () => {
    it('lists the run template', async () => {
      const { resourceTemplates } = await server.listResourceTemplates();

      expect(resourceTemplates.map((template) => template.uriTemplate)).toContain('job://runs/{runId}');
    });

    it('reads a run as JSON with its state, revision and progress', async () => {
      closeGate();
      openGate();
      const started = await startRun(server, 'progress_job', {});
      await finished(server, started.runId);

      const read = await server.readResource(started.uri, { authContext: alice });
      const [content] = read.contents as Array<{ uri: string; mimeType: string; text: string }>;

      expect(content).toEqual(expect.objectContaining({ uri: started.uri, mimeType: 'application/json' }));
      expect(JSON.parse(content.text)).toEqual(
        expect.objectContaining({
          runId: started.runId,
          jobName: 'progress_job',
          state: 'completed',
          result: { steps: 3 },
          progress: { progress: 3, total: 3, message: 'step 3' },
          revision: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      );
    });

    it("reads another caller's run as not found, unless the job's read rule lets them", async () => {
      const started = await startRun(server, 'guarded_hang_job', { tag: 'r1' });

      await expect(server.readResource(started.uri, { authContext: bob })).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
      const read = await server.readResource(started.uri, { authContext: operator });
      expect(JSON.parse((read.contents[0] as { text: string }).text)).toEqual(
        expect.objectContaining({ runId: started.runId, jobName: 'guarded_hang_job' }),
      );

      await server.callTool('cancel_job', { runId: started.runId }, { authContext: alice });
      await finished(server, started.runId);
    });

    it('reads an unknown run as not found', async () => {
      await expect(server.readResource('job://runs/no-such-run', { authContext: alice })).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it('sends resources/updated to a subscriber as the run progresses', async () => {
      const client = await server.connect('subscriber-session');
      closeGate();
      const started = (await client.executeJob('progress_job', {}, { background: true })) as unknown as StartedRun;
      const updates: string[] = [];
      client.onResourceUpdated((uri) => updates.push(uri));

      await client.subscribeResource(started.uri);
      openGate();
      await finished(server, started.runId);
      await waitFor(() => updates.length >= 4, 'the progress updates');

      expect(new Set(updates)).toEqual(new Set([started.uri]));
      const read = await client.readResource(started.uri);
      expect(JSON.parse((read.contents[0] as { text: string }).text)).toEqual(
        expect.objectContaining({ state: 'completed', progress: { progress: 3, total: 3, message: 'step 3' } }),
      );
      await client.close();
    });
  });
});

describe('admission', () => {
  it('refuses an attempt that waits past maxWaitMs for a run slot, with a remedy', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-admission', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true, admission: { concurrency: 1, maxWaitMs: 50 } },
    });
    try {
      const busy = await startRun(server, 'hang_job', { tag: 'a1' });
      await waitFor(() => entered.includes('a1'), 'the first job to start');

      const refusal = server.callTool(
        'execute_job',
        { name: 'quick_job', input: { tag: 'a2' } },
        { authContext: alice },
      );

      await expect(refusal).rejects.toBeInstanceOf(JobAdmissionTimeoutError);
      await expect(refusal).rejects.toMatchObject({
        code: 'JOB_ADMISSION_TIMEOUT',
        remedy: { say: expect.any(String) },
      });

      await server.callTool('cancel_job', { runId: busy.runId }, { authContext: alice });
      await finished(server, busy.runId);
      const next = await server.callTool(
        'execute_job',
        { name: 'quick_job', input: { tag: 'a3' } },
        { authContext: alice },
      );
      expect(next.structuredContent).toEqual(expect.objectContaining({ state: 'completed' }));
    } finally {
      await server.dispose();
    }
  });

  it('frees the slot of an attempt that throws, times out, is cancelled or is interrupted', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-slots', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true, admission: { concurrency: 1, maxWaitMs: 200 } },
    });
    const call = (name: string, tag: string) =>
      server.callTool('execute_job', { name, input: { tag } }, { authContext: alice });
    const expectSlotFree = async () =>
      expect((await call('quick_job', 'next')).structuredContent).toEqual(
        expect.objectContaining({ state: 'completed' }),
      );
    try {
      await expect(call('boom_job', 'l1')).rejects.toThrow('boom');
      await expectSlotFree();

      await expect(call('retry_timeout_job', 'l2')).rejects.toBeInstanceOf(JobTimeoutError);
      await expectSlotFree();

      const cancelled = await startRun(server, 'hang_job', { tag: 'l3' });
      await waitFor(() => entered.includes('l3'), 'the job to start');
      await server.callTool('cancel_job', { runId: cancelled.runId }, { authContext: alice });
      await finished(server, cancelled.runId);
      await expectSlotFree();

      const interrupted = await startRun(server, 'hang_job', { tag: 'l4' });
      await waitFor(() => entered.includes('l4'), 'the job to start');
      await managerOf(server).dispose();
      expect((await finished(server, interrupted.runId)).state).toBe('interrupted');
      await expectSlotFree();
    } finally {
      await server.dispose();
    }
  });

  it('refuses an attempt while less memory is free than memoryMb', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-memory', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true, admission: { memoryMb: 1e12, maxWaitMs: 20 } },
    });
    try {
      await expect(
        server.callTool('execute_job', { name: 'quick_job', input: { tag: 'm1' } }, { authContext: alice }),
      ).rejects.toBeInstanceOf(JobAdmissionTimeoutError);
    } finally {
      await server.dispose();
    }
  });
});

describe('shutdown', () => {
  it('waits for the interrupted runs and their cleanups at most lifecycle.shutdownHookTimeoutMs', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-shutdown', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      lifecycle: { shutdownHookTimeoutMs: 100 },
      jobs: { enabled: true },
    });
    await startRun(server, 'slow_cleanup_hang_job', { tag: 's1' });
    await waitFor(() => entered.includes('s1'), 'the job to start');

    const disposing = Date.now();
    await server.dispose();

    expect(Date.now() - disposing).toBeLessThan(1_500);
  });
});

const sqliteWarnings: string[] = [];

@LogTransport({ name: 'SqliteWarnings', description: 'Keeps warnings for assertions' })
class SqliteWarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) sqliteWarnings.push(record.message);
  }
}

describe('jobs on the top-level sqlite store', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-durable-jobs-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function open(): Promise<DirectMcpServer> {
    return FrontMcpInstance.createDirect({
      info: { name: 'durable-sqlite', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Off },
      sqlite: { path: path.join(dir, 'state.sqlite') },
    });
  }

  it('counts its jobs as a consumer of the top-level sqlite, so it does not call the block unused', async () => {
    sqliteWarnings.length = 0;
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'durable-sqlite-jobs-only', version: '1.0.0' },
      apps: [DurableApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [SqliteWarningCapture] },
      sqlite: { path: path.join(dir, 'state.sqlite') },
      transport: { persistence: false },
      tasks: { enabled: false },
    });
    await server.dispose();

    expect(sqliteWarnings.filter((message) => message.includes('no subsystem consumes it'))).toEqual([]);
  });

  it('interrupts the runs left at shutdown, runs their cleanup, and keeps the record for the next server', async () => {
    const first = await open();
    const started = await startRun(first, 'hang_job', { tag: 'i1' });
    await waitFor(() => entered.includes('i1'), 'the job to start');

    await first.dispose();

    expect(cleanups).toEqual(['i1:interrupt']);
    const second = await open();
    try {
      expect(await managerOf(second).getStatus(started.runId)).toEqual(
        expect.objectContaining({
          state: 'interrupted',
          error: expect.objectContaining({ name: 'JobInterruptedError' }),
        }),
      );
      const status = await second.callTool('get_job_status', { runId: started.runId }, { authContext: alice });
      expect(status.structuredContent).toEqual(expect.objectContaining({ state: 'interrupted' }));
    } finally {
      await second.dispose();
    }
  });

  it('sees a cancel another process wrote to the store and aborts the run', async () => {
    const first = await open();
    const second = await open();
    try {
      const started = await startRun(first, 'hang_job', { tag: 'x1' });
      await waitFor(() => entered.includes('x1'), 'the job to start');

      const response = await second.callTool('cancel_job', { runId: started.runId }, { authContext: alice });

      expect(response.structuredContent).toEqual({ runId: started.runId, state: 'cancelled' });
      await waitFor(() => cleanups.includes('x1:cancel'), 'the owning server to abort the run');
      expect((await finished(first, started.runId)).state).toBe('cancelled');
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('keeps a run cancelled when its attempt ends on its own after another process cancelled it', async () => {
    failGate = new Promise((resolve) => {
      openFailGate = resolve;
    });
    const first = await open();
    const second = await open();
    try {
      const inline = first.callTool(
        'execute_job',
        { name: 'gated_fail_job', input: { tag: 'x2' } },
        { authContext: alice },
      );
      await waitFor(() => entered.includes('x2'), 'the job to start');
      const [run] = await managerOf(first).listRuns({ jobId: 'gated_fail_job', state: 'running' });

      await second.callTool('cancel_job', { runId: run.runId }, { authContext: alice });
      openFailGate();
      await inline.catch(() => undefined);

      expect((await managerOf(first).getStatus(run.runId))?.state).toBe('cancelled');
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});

describe('@Job({ cleanup }) validation', () => {
  const probeJob = () =>
    class extends JobContext {
      async execute(): Promise<Record<string, never>> {
        return {};
      }
    };

  it.each([
    ['a string', 'rm -rf /tmp'],
    ['a zero time limit', { run: () => undefined, timeoutMs: 0 }],
  ])('refuses %s at decoration', (_case, cleanup) => {
    const decorate = () =>
      Job({ name: 'bad_cleanup', inputSchema: {}, outputSchema: {}, cleanup: cleanup as never })(probeJob());

    expect(decorate).toThrow();
  });

  it('accepts a function and a { run, timeoutMs } cleanup', () => {
    const decorate = (cleanup: unknown) => () =>
      Job({ name: 'good_cleanup', inputSchema: {}, outputSchema: {}, cleanup: cleanup as never })(probeJob());

    expect(decorate(() => undefined)).not.toThrow();
    expect(decorate({ run: () => undefined, timeoutMs: 500 })).not.toThrow();
  });
});
