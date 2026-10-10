/**
 * A workflow step's timeout bounds the whole attempt, including the CONTEXT providers its job is built
 * with and the `authorities.pipes` that load the step's `this.auth`: a hung one fails the attempt with
 * `WorkflowJobTimeoutError`, and the retry loop then runs the next attempt. Each attempt runs the
 * `jobs:execute-job` flow (#700), which the step executor aborts on a timeout, so an attempt whose
 * providers or auth settle late never starts the job.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, job, JobContext, LogLevel, Plugin, ProviderScope, type FlowCtxOf } from '../../../common';
import type { WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { FRONTMCP_CONTEXT, type FrontMcpContext } from '../../../context';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { InvalidOutputError } from '../../../errors/mcp.error';
import { WorkflowJobTimeoutError } from '../../../errors/workflow.errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { JobHook } from '../../../index';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { type Scope } from '../../../scope/scope.instance';
import { WorkflowStepExecutor } from '../workflow-step.executor';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowStepExecutor>[1];

/** What each auth-pipe run waits for, in order; an empty list lets it through at once. */
let pipeLoads: Array<() => Promise<void>> = [];
/** What building the slow app's CONTEXT provider waits for; undefined lets it through at once. */
let providerLoad: (() => Promise<void>) | undefined;

const executions: string[] = [];
let slowJobsBuilt = 0;

const hang = () => new Promise<void>(() => undefined);

@Job({ name: 'piped', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class PipedJob extends JobContext {
  async execute() {
    executions.push('piped');
    return { ok: true };
  }
}

@Job({ name: 'charge', inputSchema: {}, outputSchema: { receipt: z.string() } })
class ChargeJob extends JobContext {
  async execute() {
    executions.push('charge');
    return { receipt: 42 } as unknown as { receipt: string };
  }
}

@App({ id: 'piped-app', name: 'Piped', jobs: [PipedJob, ChargeJob] })
class PipedApp {}

abstract class SlowDependency {}

@Job({ name: 'slow-providers', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class SlowProvidersJob extends JobContext {
  /** Counts the instances built (a constructor would read as a DI dependency). */
  readonly built = ++slowJobsBuilt;

  async execute() {
    executions.push('slow-providers');
    return { ok: true };
  }
}

@App({
  id: 'slow-app',
  name: 'Slow',
  jobs: [SlowProvidersJob],
  providers: [
    {
      provide: SlowDependency,
      name: 'SlowDependency',
      scope: ProviderScope.CONTEXT,
      inject: () => [FRONTMCP_CONTEXT] as const,
      useFactory: async (_context: FrontMcpContext) => {
        if (providerLoad) await providerLoad();
        return {};
      },
    },
  ],
})
class SlowApp {}

const startedTrace: string[] = [];
let finishStartedJob: () => void = () => undefined;
let startedJobSignal: AbortSignal | undefined;

@Job({ name: 'started', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class StartedJob extends JobContext {
  async execute() {
    startedJobSignal = this.signal;
    await new Promise<void>((resolve) => (finishStartedJob = resolve));
    startedTrace.push('execute returned');
    return { ok: true };
  }
}

@Job({ name: 'started-failing', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class StartedFailingJob extends JobContext {
  async execute(): Promise<{ ok: boolean }> {
    await new Promise<void>((resolve) => (finishStartedJob = resolve));
    startedTrace.push('execute threw');
    throw new Error('the job failed on its own');
  }
}

@Job({ name: 'signal-probe', inputSchema: {}, outputSchema: { signal: z.string() } })
class SignalProbeJob extends JobContext {
  async execute() {
    return { signal: this.signal ? 'present' : 'none' };
  }
}

const startedFunctionJob = job({ name: 'started-function', inputSchema: {}, outputSchema: { ok: z.boolean() } })(async (
  _input,
  ctx,
) => {
  startedJobSignal = ctx.signal;
  await new Promise<void>((resolve) => (finishStartedJob = resolve));
  return { ok: true };
});

@Plugin({ name: 'step-audit' })
class StepAuditPlugin {
  @JobHook.Did('execute')
  executed() {
    startedTrace.push('did:execute');
  }

  @JobHook.Did('finalize')
  finalized(flowCtx: FlowCtxOf<'jobs:execute-job'>) {
    startedTrace.push(`did:finalize:${flowCtx.state.flowError?.constructor.name ?? 'none'}`);
  }
}

/** Wait until the started job's trace has `length` entries, polling for at most two seconds. */
async function waitForTrace(length: number): Promise<void> {
  for (let poll = 0; poll < 400 && startedTrace.length < length; poll++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

@App({
  id: 'started-app',
  name: 'Started',
  jobs: [StartedJob, StartedFailingJob, SignalProbeJob, startedFunctionJob],
  plugins: [StepAuditPlugin],
})
class StartedApp {}

describe('WorkflowStepExecutor', () => {
  let server: DirectMcpServer;
  let jobs: JobRegistryInterface;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-step-timeout', version: '1.0.0' },
      apps: [PipedApp, SlowApp, StartedApp],
      logging: { level: LogLevel.Off },
      authorities: {
        pipes: [
          async () => {
            const load = pipeLoads.shift();
            if (load) await load();
            return {};
          },
        ],
      },
    });
    const registry = (server as unknown as { scope: Scope }).scope.jobs;
    if (!registry) throw new Error('jobs are not enabled');
    jobs = registry;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    pipeLoads = [];
    providerLoad = undefined;
    executions.length = 0;
    slowJobsBuilt = 0;
    startedTrace.length = 0;
    startedJobSignal = undefined;
  });

  describe('step timeout', () => {
    it('times out an attempt whose auth pipes never settle', async () => {
      pipeLoads = [hang];
      const step = { id: 'step-1', jobName: 'piped', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      expect(executions).toEqual([]);
    });

    it('retries after an attempt whose auth pipes timed out', async () => {
      pipeLoads = [hang, async () => undefined];
      const step = {
        id: 'step-1',
        jobName: 'piped',
        timeout: 20,
        retry: { maxAttempts: 2, backoffMs: 1 },
      } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
      expect(executions).toEqual(['piped']);
    });

    it('times out an attempt whose CONTEXT providers never finish building', async () => {
      providerLoad = hang;
      const step = { id: 'step-1', jobName: 'slow-providers', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      expect(slowJobsBuilt).toBe(0);
    }, 2000);

    it('does not build the job when its CONTEXT providers finish after the attempt timed out', async () => {
      let finishProviders: () => void = () => undefined;
      providerLoad = () => new Promise<void>((resolve) => (finishProviders = resolve));
      const step = { id: 'step-1', jobName: 'slow-providers', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      finishProviders();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(slowJobsBuilt).toBe(0);
      expect(executions).toEqual([]);
    });

    it('does not start the job when its auth pipes settle after the attempt timed out', async () => {
      let finishAuthLoad: () => void = () => undefined;
      pipeLoads = [() => new Promise<void>((resolve) => (finishAuthLoad = resolve))];
      const step = { id: 'step-1', jobName: 'piped', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      finishAuthLoad();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(executions).toEqual([]);
    });
  });

  describe('step timeout of a started job (#815)', () => {
    it("ends the abandoned attempt's flow as failed, so Did(execute) does not run and finalize sees the timeout", async () => {
      const step = { id: 'step-1', jobName: 'started', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      finishStartedJob();
      await waitForTrace(2);

      expect(startedTrace).toEqual(['execute returned', 'did:finalize:WorkflowJobTimeoutError']);
    });

    it('aborts the signal the job reads from this.signal when its step gives up', async () => {
      const step = { id: 'step-1', jobName: 'started', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);

      expect(startedJobSignal?.aborted).toBe(true);
      expect(startedJobSignal?.reason).toBeInstanceOf(WorkflowJobTimeoutError);
      finishStartedJob();
      await waitForTrace(2);
    });

    it('gives a functional job the signal as ctx.signal', async () => {
      const step = {
        id: 'step-1',
        jobName: 'started-function',
        timeout: 20,
        retry: { maxAttempts: 1 },
      } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);

      expect(startedJobSignal?.aborted).toBe(true);
      finishStartedJob();
      await waitForTrace(1);
    });

    it('fails the abandoned attempt with the timeout, not the error the job threw after it', async () => {
      const step = { id: 'step-1', jobName: 'started-failing', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
      finishStartedJob();
      await waitForTrace(2);

      expect(startedTrace).toEqual(['execute threw', 'did:finalize:WorkflowJobTimeoutError']);
    });

    it('gives a job run outside a workflow step no signal', async () => {
      const response = await server.callTool('execute_job', { name: 'signal-probe' });

      expect((response.structuredContent as { result?: unknown }).result).toEqual({ signal: 'none' });
    });
  });

  describe('output check', () => {
    it('does not retry a step whose job result fails its outputSchema', async () => {
      const step = { id: 'step-1', jobName: 'charge', retry: { maxAttempts: 3, backoffMs: 1 } } as WorkflowStep;
      const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

      await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(InvalidOutputError);
      expect(executions).toEqual(['charge']);
    });
  });

  it('fails a step that names no registered job', async () => {
    const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

    await expect(executor.executeStep({ id: 'step-1', jobName: 'missing' } as WorkflowStep, {})).rejects.toThrow(
      /missing/,
    );
  });
});
