/**
 * Every attempt of a job runs the hookable `jobs:execute-job` flow (#700): inline and background runs,
 * each retry, each workflow step, and an in-process caller of the job execution manager. Before, jobs
 * ran outside any flow, so a hook (audit, metrics, quota, authorization) saw none of them, and a hook
 * declared on a `@Job` class failed startup.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FlowControl, Job, JobContext, LogLevel, Plugin, Workflow, type FlowCtxOf } from '../../common';
import { FrontMcpContextStorage } from '../../context';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidOutputError, JobNotAuthorizedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { JobHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import ExecuteJobFlow from '../flows/execute-job.flow';
import { retryDelayMs, runJobAttemptFlow, willRetryJobAttempt } from '../job-attempt';
import { type JobRunRecord } from '../store/job-state.interface';
import { MemoryJobStateStore } from '../store/memory-job-state.store';

const trace: string[] = [];

type JobFlowCtx = FlowCtxOf<'jobs:execute-job'>;

function at(type: string, stage: string, flowCtx: JobFlowCtx): string {
  return `${type}:${stage}:${flowCtx.state.job?.name}:${flowCtx.state.attempt}`;
}

/** Records each stage of every job attempt of its app, and plays a few parts some tests ask for. */
@Plugin({ name: 'job-audit' })
class JobAuditPlugin {
  @JobHook.Did('parseInput')
  parsed(flowCtx: JobFlowCtx) {
    trace.push(at('did', 'parseInput', flowCtx));
    const { runId, workflow } = flowCtx.state;
    if (runId) trace.push(`run:${flowCtx.state.job?.name}:${runId}`);
    if (workflow) trace.push(`step:${workflow.name}/${workflow.stepId}:${workflow.runId ? 'in-run' : 'no-run'}`);
  }

  @JobHook.Will('checkJobAuthorization')
  authorize(flowCtx: JobFlowCtx) {
    trace.push(at('will', 'checkJobAuthorization', flowCtx));
    if (flowCtx.state.job?.name === 'guarded_job') throw new JobNotAuthorizedError('guarded_job');
  }

  @JobHook.Will('validateInput')
  validating(flowCtx: JobFlowCtx) {
    trace.push(at('will', 'validateInput', flowCtx));
    // A hook may end the attempt without an answer or an error
    if (flowCtx.state.job?.name === 'aborted_job') FlowControl.abort('stopped by a hook');
  }

  @JobHook.Did('createJobContext')
  built(flowCtx: JobFlowCtx) {
    trace.push(at('did', 'createJobContext', flowCtx));
  }

  @JobHook.Will('execute')
  executing(flowCtx: JobFlowCtx) {
    trace.push(at('will', 'execute', flowCtx));
    // A hook may answer for the job, as a cache would
    if (flowCtx.state.job?.name === 'cached_job') flowCtx.respond({ result: { cached: true }, logs: [] });
  }

  @JobHook.Did('execute')
  executed(flowCtx: JobFlowCtx) {
    trace.push(at('did', 'execute', flowCtx));
  }

  @JobHook.Did('validateOutput')
  validated(flowCtx: JobFlowCtx) {
    trace.push(at('did', 'validateOutput', flowCtx));
  }

  @JobHook.Around('updateRunState')
  async recording(flowCtx: JobFlowCtx, next: () => Promise<void>) {
    trace.push(`${at('around', 'updateRunState', flowCtx)}:${flowCtx.state.flowError ? 'error' : 'ok'}`);
    // A hook that keeps the stage from recording does not leave the run record behind
    if (flowCtx.state.job?.name.startsWith('unrecorded')) return;
    await next();
  }

  @JobHook.Will('finalize')
  finalizing(flowCtx: JobFlowCtx) {
    trace.push(at('will', 'finalize', flowCtx));
  }
}

@Job({ name: 'count_job', inputSchema: { n: z.number().default(1) }, outputSchema: { count: z.number() } })
class CountJob extends JobContext {
  async execute({ n }: { n: number }) {
    this.log(`counting ${n}`);
    return { count: n };
  }
}

@Job({
  name: 'flaky_job',
  inputSchema: {},
  outputSchema: { attempt: z.number() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
class FlakyJob extends JobContext {
  async execute() {
    if (this.attempt < 3) throw new Error(`attempt ${this.attempt} failed`);
    return { attempt: this.attempt };
  }
}

let guardedRuns = 0;

@Job({ name: 'guarded_job', inputSchema: {}, outputSchema: {}, retry: { maxAttempts: 3, backoffMs: 1 } })
class GuardedJob extends JobContext {
  async execute() {
    guardedRuns++;
    return {};
  }
}

@Job({ name: 'cached_job', inputSchema: {}, outputSchema: { cached: z.boolean() } })
class CachedJob extends JobContext {
  async execute(): Promise<{ cached: boolean }> {
    throw new Error('the hook answers for this job');
  }
}

@Job({ name: 'unrecorded_job', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class UnrecordedJob extends JobContext {
  async execute() {
    return { ok: true };
  }
}

@Job({
  name: 'unrecorded_failing_job',
  inputSchema: {},
  outputSchema: {},
  retry: { maxAttempts: 2, backoffMs: 1 },
})
class UnrecordedFailingJob extends JobContext {
  async execute(): Promise<Record<string, never>> {
    throw new Error('always fails');
  }
}

@Job({ name: 'aborted_job', inputSchema: {}, outputSchema: {} })
class AbortedJob extends JobContext {
  async execute() {
    return {};
  }
}

@Job({ name: 'thrower_job', inputSchema: {}, outputSchema: {} })
class ThrowerJob extends JobContext {
  async execute(): Promise<Record<string, never>> {
    throw 'not an error object';
  }
}

@Job({ name: 'whoami_job', inputSchema: {}, outputSchema: { sessionId: z.string(), requestId: z.string() } })
class WhoAmIJob extends JobContext {
  async execute() {
    return { sessionId: this.context.sessionId, requestId: this.context.requestId };
  }
}

/** A job class whose own hooks run on its attempts: static ones from the first stage, instance ones on the instance. */
@Job({ name: 'hooked_job', inputSchema: { who: z.string() }, outputSchema: { greeting: z.string() } })
class HookedJob extends JobContext {
  @JobHook.Did('parseInput')
  static defaults(flowCtx: JobFlowCtx) {
    const input = (flowCtx.state.input ?? {}) as Record<string, unknown>;
    flowCtx.state.set('input', { who: 'world', ...input });
  }

  @JobHook.Will('checkJobAuthorization')
  static refuseMallory(this: typeof HookedJob, flowCtx: JobFlowCtx) {
    trace.push(`hooked_job:static:checkJobAuthorization:this-is-class=${this === HookedJob}`);
    if ((flowCtx.state.input as { who?: unknown } | undefined)?.who === 'mallory') {
      throw new JobNotAuthorizedError('hooked_job');
    }
  }

  @JobHook.Did('createJobContext')
  built() {
    trace.push(`hooked_job:instance:createJobContext:${this instanceof HookedJob}`);
  }

  @JobHook.Will('execute')
  beforeExecute() {
    trace.push(`hooked_job:instance:execute:attempt=${this.attempt}`);
  }

  async execute({ who }: { who: string }) {
    return { greeting: `hello ${who}` };
  }
}

@Workflow({
  name: 'count_flow',
  steps: [
    { id: 'first', jobName: 'count_job', input: { n: 2 } },
    { id: 'second', jobName: 'flaky_job', dependsOn: ['first'], retry: { maxAttempts: 3, backoffMs: 1 } },
  ],
})
class CountFlow {}

@App({
  id: 'desk',
  name: 'Desk',
  plugins: [JobAuditPlugin],
  jobs: [
    CountJob,
    FlakyJob,
    GuardedJob,
    CachedJob,
    UnrecordedJob,
    UnrecordedFailingJob,
    ThrowerJob,
    AbortedJob,
    WhoAmIJob,
    HookedJob,
  ],
  workflows: [CountFlow],
})
class DeskApp {}

@Job({ name: 'other_job', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class OtherJob extends JobContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'other', name: 'Other', jobs: [OtherJob] })
class OtherApp {}

interface RunResult {
  runId: string;
  state: string;
  result?: unknown;
  logs?: string[];
}

describe('jobs:execute-job flow (#700)', () => {
  let server: DirectMcpServer;
  let scope: Scope;
  let manager: JobExecutionManager;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'execute-job-flow', version: '1.0.0' },
      apps: [DeskApp, OtherApp],
      logging: { level: LogLevel.Off },
    });
    scope = (server as unknown as { scope: Scope }).scope;
    const executionManager = (scope as unknown as { _jobExecutionManager?: JobExecutionManager })._jobExecutionManager;
    if (!executionManager) throw new Error('jobs are not enabled');
    manager = executionManager;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    trace.length = 0;
    guardedRuns = 0;
  });

  function jobNamed(name: string) {
    const job = scope.jobs?.findByName(name);
    if (!job) throw new Error(`${name} is not registered`);
    return job;
  }

  async function runJob(name: string, input: Record<string, unknown> = {}): Promise<RunResult> {
    const response = await server.callTool('execute_job', { name, input });
    return response.structuredContent as unknown as RunResult;
  }

  async function waitForRun(runId: string): Promise<JobRunRecord> {
    for (let poll = 0; poll < 200; poll++) {
      const run = await manager.getStatus(runId);
      if (run && (run.state === 'completed' || run.state === 'failed')) return run;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`run ${runId} did not finish`);
  }

  it('runs the stages in order, with hooks on each', async () => {
    const run = await runJob('count_job', { n: 4 });

    expect(run).toEqual(expect.objectContaining({ state: 'completed', result: { count: 4 } }));
    expect(run.logs).toEqual([expect.stringContaining('counting 4')]);
    expect(trace.filter((entry) => !entry.startsWith('run:'))).toEqual([
      'did:parseInput:count_job:1',
      'will:checkJobAuthorization:count_job:1',
      'will:validateInput:count_job:1',
      'did:createJobContext:count_job:1',
      'will:execute:count_job:1',
      'did:execute:count_job:1',
      'did:validateOutput:count_job:1',
      'around:updateRunState:count_job:1:ok',
      'will:finalize:count_job:1',
    ]);
    expect(trace).toContain(`run:count_job:${run.runId}`);
  });

  it('runs the flow once per attempt, recording each on the run', async () => {
    const run = await runJob('flaky_job');

    expect(run).toEqual(expect.objectContaining({ state: 'completed', result: { attempt: 3 } }));
    expect(trace.filter((entry) => entry.startsWith('around:updateRunState'))).toEqual([
      'around:updateRunState:flaky_job:1:error',
      'around:updateRunState:flaky_job:2:error',
      'around:updateRunState:flaky_job:3:ok',
    ]);
    await expect(manager.getStatus(run.runId)).resolves.toEqual(
      expect.objectContaining({ state: 'completed', attempt: 3, result: { attempt: 3 } }),
    );
  });

  it('runs a background run through the flow, in a context of its own with the caller session', async () => {
    const inline = await runJob('whoami_job');
    const response = await server.callTool('execute_job', { name: 'whoami_job', input: {}, background: true });
    const { runId } = response.structuredContent as unknown as RunResult;

    const run = await waitForRun(runId);

    expect(run.state).toBe('completed');
    expect(trace).toContain(`run:whoami_job:${runId}`);
    const inlineIds = inline.result as { sessionId: string; requestId: string };
    const backgroundIds = run.result as { sessionId: string; requestId: string };
    expect(backgroundIds.sessionId).toBe(inlineIds.sessionId);
    expect(backgroundIds.requestId).not.toBe(inlineIds.requestId);
  });

  it('runs each workflow step attempt through the flow', async () => {
    const response = await server.callTool('execute_workflow', { name: 'count_flow' });
    const run = response.structuredContent as unknown as RunResult;

    expect(run.state).toBe('completed');
    expect(trace).toContain('step:count_flow/first:in-run');
    expect(trace).toContain('step:count_flow/second:in-run');
    expect(trace.filter((entry) => entry.startsWith('will:execute:flaky_job'))).toEqual([
      'will:execute:flaky_job:1',
      'will:execute:flaky_job:2',
      'will:execute:flaky_job:3',
    ]);
    // A step's attempts have no run record of their own: the workflow run keeps the steps
    expect(trace.some((entry) => entry.startsWith('run:flaky_job'))).toBe(false);
  });

  it('runs an in-process caller without a request through the flow, in a context for its auth', async () => {
    const result = await manager.executeJob(jobNamed('whoami_job'), {}, { authInfo: { sessionId: 'trigger-session' } });

    expect(result).toEqual(
      expect.objectContaining({
        state: 'completed',
        result: expect.objectContaining({ sessionId: 'trigger-session' }),
      }),
    );
    expect(trace).toContain('did:parseInput:whoami_job:1');
  });

  it("gives a background run without a caller context a fresh context, not the starter's request", async () => {
    const storage = scope.providers.get(FrontMcpContextStorage);
    const outer = await storage.run({ sessionId: 'outer-request', scopeId: scope.id }, async () => {
      const started = await manager.executeJob(
        jobNamed('whoami_job'),
        {},
        {
          background: true,
          authInfo: { sessionId: 'job-session' },
        },
      );
      return { runId: started.runId, requestId: storage.getStore()?.requestId };
    });

    const run = await waitForRun(outer.runId);

    const ids = run.result as { sessionId: string; requestId: string };
    expect(ids.sessionId).toBe('job-session');
    expect(ids.requestId).not.toBe(outer.requestId);
  });

  it('does not retry an attempt a hook denied, and records it as failed', async () => {
    await expect(manager.executeJob(jobNamed('guarded_job'), {})).rejects.toBeInstanceOf(JobNotAuthorizedError);

    expect(guardedRuns).toBe(0);
    expect(trace.filter((entry) => entry.startsWith('will:checkJobAuthorization'))).toEqual([
      'will:checkJobAuthorization:guarded_job:1',
    ]);
    const [run] = await manager.listRuns({ jobId: 'guarded_job' });
    expect(run).toEqual(expect.objectContaining({ state: 'failed', attempt: 1 }));
  });

  it("records a hook's answer as the job's result", async () => {
    const run = await runJob('cached_job');

    expect(run).toEqual(expect.objectContaining({ state: 'completed', result: { cached: true } }));
    expect(trace).not.toContain('did:execute:cached_job:1');
    await expect(manager.getStatus(run.runId)).resolves.toEqual(
      expect.objectContaining({ state: 'completed', result: { cached: true } }),
    );
  });

  it('records the outcome even when a hook keeps the stage from recording it', async () => {
    const run = await runJob('unrecorded_job');
    await expect(manager.getStatus(run.runId)).resolves.toEqual(
      expect.objectContaining({ state: 'completed', attempt: 1, result: { ok: true } }),
    );

    await expect(manager.executeJob(jobNamed('unrecorded_failing_job'), {})).rejects.toThrow('always fails');
    const [failed] = await manager.listRuns({ jobId: 'unrecorded_failing_job' });
    expect(failed).toEqual(
      expect.objectContaining({
        state: 'failed',
        attempt: 2,
        error: expect.objectContaining({ message: 'always fails' }),
      }),
    );
  });

  it('records an attempt a hook ended without an answer as failed', async () => {
    await expect(manager.executeJob(jobNamed('aborted_job'), {})).rejects.toBeInstanceOf(FlowControl);

    const [run] = await manager.listRuns({ jobId: 'aborted_job' });
    expect(run).toEqual(
      expect.objectContaining({
        state: 'failed',
        error: expect.objectContaining({ message: 'The job attempt ended before it produced a result' }),
      }),
    );
  });

  it('builds the job with the providers a caller without a context passes', async () => {
    const result = await manager.executeJob(jobNamed('count_job'), { n: 7 }, { contextProviders: scope.providers });

    expect(result).toEqual(expect.objectContaining({ state: 'completed', result: { count: 7 } }));
  });

  it('gives a background run without a caller session an anonymous one', async () => {
    const { runId } = await manager.executeJob(jobNamed('whoami_job'), {}, { background: true });

    const run = await waitForRun(runId);

    expect((run.result as { sessionId: string }).sessionId).toMatch(/^anon:/);
  });

  it('runs a background workflow of a manager without a scope through the flow', async () => {
    const workflow = scope.workflows?.findByName('count_flow');
    const jobs = scope.jobs;
    if (!workflow || !jobs) throw new Error('count_flow is not registered');
    const scopeless = new JobExecutionManager(new MemoryJobStateStore(), scope.logger);

    const { runId } = await scopeless.executeWorkflow(workflow, jobs, { background: true });
    for (let poll = 0; poll < 200; poll++) {
      const run = await scopeless.getStatus(runId);
      if (run?.state === 'completed' || run?.state === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await expect(scopeless.getStatus(runId)).resolves.toEqual(expect.objectContaining({ state: 'completed' }));
    expect(trace).toContain('step:count_flow/first:in-run');
  });

  it('abandons an attempt whose signal was aborted, with a generic reason for a non-Error one', async () => {
    const abandon = new AbortController();
    abandon.abort('gave up');

    await expect(
      runJobAttemptFlow({ job: jobNamed('count_job'), input: {}, attempt: 1, authInfo: {}, signal: abandon.signal }),
    ).rejects.toThrow('The job attempt was abandoned');
    expect(trace).not.toContain('did:createJobContext:count_job:1');
  });

  it('records a thrown non-Error value as an Error', async () => {
    await expect(manager.executeJob(jobNamed('thrower_job'), {})).rejects.toThrow('not an error object');

    const [run] = await manager.listRuns({ jobId: 'thrower_job' });
    expect(run?.error).toEqual(expect.objectContaining({ message: 'not an error object', name: 'Error' }));
  });

  it("runs the job class's own hooks: static from the first stage, instance ones on the instance", async () => {
    const run = await runJob('hooked_job');

    expect(run).toEqual(expect.objectContaining({ state: 'completed', result: { greeting: 'hello world' } }));
    expect(trace.filter((entry) => entry.startsWith('hooked_job:'))).toEqual([
      'hooked_job:static:checkJobAuthorization:this-is-class=true',
      'hooked_job:instance:createJobContext:true',
      'hooked_job:instance:execute:attempt=1',
    ]);

    await expect(runJob('hooked_job', { who: 'mallory' })).rejects.toBeInstanceOf(JobNotAuthorizedError);
  });

  it("does not run an app's job hooks for another app's jobs", async () => {
    const run = await runJob('other_job');

    expect(run.state).toBe('completed');
    expect(trace).toEqual([]);
  });
});

describe('job attempt helpers', () => {
  it('retries until the last attempt, but never an outputSchema mismatch or a denial', () => {
    expect(willRetryJobAttempt(new Error('flaky'), 1, 3)).toBe(true);
    expect(willRetryJobAttempt(new Error('flaky'), 3, 3)).toBe(false);
    expect(willRetryJobAttempt(new InvalidOutputError(), 1, 3)).toBe(false);
    expect(willRetryJobAttempt(new JobNotAuthorizedError('x'), 1, 3)).toBe(false);
  });

  it('reads the error a hook failed the flow with', () => {
    let failure: unknown;
    try {
      FlowControl.fail(new JobNotAuthorizedError('x'));
    } catch (error) {
      failure = error;
    }

    expect(willRetryJobAttempt(failure, 1, 3)).toBe(false);
  });

  it('backs off exponentially up to the cap', () => {
    expect(retryDelayMs({}, 1)).toBe(1000);
    expect(retryDelayMs({ backoffMs: 10, backoffMultiplier: 3 }, 3)).toBe(90);
    expect(retryDelayMs({ backoffMs: 10, backoffMultiplier: 10, maxBackoffMs: 50 }, 4)).toBe(50);
  });

  it('names no hook owner or class for a raw input without a job', () => {
    expect(ExecuteJobFlow.resolveHookOwnerId({}, {} as never)).toBeUndefined();
    expect(ExecuteJobFlow.resolveHookEntryClass({ job: 'count_job' })).toBeUndefined();
  });
});
