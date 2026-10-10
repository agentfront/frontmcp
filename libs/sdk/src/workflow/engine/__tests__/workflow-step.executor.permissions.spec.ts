/**
 * A workflow step must satisfy the STEP JOB's own permissions
 * (GHSA-58v2-gpcc-jmqv).
 *
 * `JobExecutionManager` checks the workflow's permissions once, then the engine
 * runs each step. Without a check per step, a workflow that declares no
 * permissions of its own launders every job it references: an anonymous caller
 * reaches an `admin`-only job by asking for the workflow instead of the job.
 * Each step attempt runs the `jobs:execute-job` flow, whose `checkJobAuthorization`
 * stage applies the check (#700).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, LogLevel } from '../../../common';
import type { WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { JobNotAuthorizedError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { type Scope } from '../../../scope/scope.instance';
import { WorkflowStepExecutor } from '../workflow-step.executor';

const executions: string[] = [];

@Job({
  name: 'admin-only',
  inputSchema: {},
  outputSchema: { ok: z.boolean() },
  permissions: [{ action: 'execute', roles: ['admin'] }],
})
class AdminOnlyJob extends JobContext {
  async execute() {
    executions.push('admin-only');
    return { ok: true };
  }
}

@Job({ name: 'open', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class OpenJob extends JobContext {
  async execute() {
    executions.push('open');
    return { ok: true };
  }
}

@App({ id: 'step-permissions', name: 'Step permissions', jobs: [AdminOnlyJob, OpenJob] })
class StepPermissionsApp {}

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowStepExecutor>[1];

const step: WorkflowStep = { id: 'step-1', jobName: 'admin-only' } as WorkflowStep;

describe('WorkflowStepExecutor — step job permissions', () => {
  let server: DirectMcpServer;
  let jobs: JobRegistryInterface;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-step-permissions', version: '1.0.0' },
      apps: [StepPermissionsApp],
      logging: { level: LogLevel.Off },
    });
    const registry = (server as unknown as { scope: Scope }).scope.jobs;
    if (!registry) throw new Error('jobs are not enabled');
    jobs = registry;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    executions.length = 0;
  });

  it('refuses a step whose job the caller may not execute', async () => {
    const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

    await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(JobNotAuthorizedError);
    expect(executions).toEqual([]);
  });

  it('does not retry a denial', async () => {
    // A permission failure is not transient. Running it through the retry loop
    // would delay the error by the full backoff and bury it behind attempt logs.
    const retried: WorkflowStep = { id: 'step-1', jobName: 'admin-only', retry: { maxAttempts: 3 } } as WorkflowStep;
    const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

    const started = Date.now();
    await expect(executor.executeStep(retried, {})).rejects.toBeInstanceOf(JobNotAuthorizedError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(executions).toEqual([]);
  });

  it('runs the step when the caller holds the role the job requires', async () => {
    const executor = new WorkflowStepExecutor(jobs, logger, {
      authInfo: { user: { sub: 'u1', roles: ['admin'] } },
    });

    await expect(executor.executeStep(step, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
    expect(executions).toEqual(['admin-only']);
  });

  it('runs a step whose job declares no permissions, keeping the documented fail-open', async () => {
    const openStep: WorkflowStep = { id: 'step-1', jobName: 'open' } as WorkflowStep;
    const executor = new WorkflowStepExecutor(jobs, logger, { authInfo: {} });

    await expect(executor.executeStep(openStep, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
  });
});
