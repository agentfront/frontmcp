/**
 * A workflow step's timeout bounds the whole attempt, including the CONTEXT providers its job is built
 * with and the `authorities.pipes` that load the step's `this.auth`: a hung one fails the attempt with
 * `WorkflowJobTimeoutError`, and the retry loop then runs the next attempt. Each attempt runs the
 * `jobs:execute-job` flow (#700), which the step executor aborts on a timeout, so an attempt whose
 * providers or auth settle late never starts the job.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, LogLevel, ProviderScope } from '../../../common';
import type { WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { FRONTMCP_CONTEXT, type FrontMcpContext } from '../../../context';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { InvalidOutputError } from '../../../errors/mcp.error';
import { WorkflowJobTimeoutError } from '../../../errors/workflow.errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
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

describe('WorkflowStepExecutor', () => {
  let server: DirectMcpServer;
  let jobs: JobRegistryInterface;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-step-timeout', version: '1.0.0' },
      apps: [PipedApp, SlowApp],
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
