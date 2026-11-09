/**
 * A failed step skips every step that depends on it, directly or not, while a step its `condition`
 * skipped still lets its dependents run. A step is tried as many times as its job's `retry` says:
 * once when the job has none, as `execute_job` runs it.
 */
import 'reflect-metadata';

import { App, Job, JobContext, LogLevel } from '../../../common';
import type { WorkflowMetadata, WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { type Scope } from '../../../scope/scope.instance';
import { WorkflowEngine } from '../workflow.engine';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowEngine>[2];

const ran: string[] = [];

@Job({ name: 'succeed', inputSchema: {}, outputSchema: {} })
class SucceedJob extends JobContext {
  async execute() {
    ran.push('succeed');
    return {};
  }
}

@Job({ name: 'fail', inputSchema: {}, outputSchema: {} })
class FailJob extends JobContext {
  async execute(): Promise<Record<string, never>> {
    ran.push('fail');
    throw new Error('step failed');
  }
}

@Job({ name: 'fail-twice-retried', inputSchema: {}, outputSchema: {}, retry: { maxAttempts: 2, backoffMs: 0 } })
class FailTwiceRetriedJob extends JobContext {
  async execute(): Promise<Record<string, never>> {
    ran.push('fail-twice-retried');
    throw new Error('step failed');
  }
}

@App({ id: 'failures', name: 'Failures', jobs: [SucceedJob, FailJob, FailTwiceRetriedJob] })
class FailuresApp {}

describe('WorkflowEngine failures', () => {
  let server: DirectMcpServer;
  let registry: JobRegistryInterface;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-engine-failures', version: '1.0.0' },
      apps: [FailuresApp],
      logging: { level: LogLevel.Off },
    });
    const jobs = (server as unknown as { scope: Scope }).scope.jobs;
    if (!jobs) throw new Error('jobs are not enabled');
    registry = jobs;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    ran.length = 0;
  });

  const run = (steps: WorkflowStep[]) =>
    new WorkflowEngine({ name: 'pipeline', steps } as WorkflowMetadata, registry, logger, { authInfo: {} }).execute();

  it('skips every step that depends on a failed step, directly or not', async () => {
    const result = await run([
      { id: 'a', jobName: 'fail' },
      { id: 'b', jobName: 'succeed', dependsOn: ['a'] },
      { id: 'c', jobName: 'succeed', dependsOn: ['b'] },
      { id: 'd', jobName: 'succeed', dependsOn: ['c'] },
    ]);

    expect(result.state).toBe('failed');
    expect(ran).toEqual(['fail']);
    expect(result.stepResults['b'].state).toBe('skipped');
    expect(result.stepResults['c'].state).toBe('skipped');
    expect(result.stepResults['d'].state).toBe('skipped');
  });

  it('still runs the steps that do not depend on the failed step', async () => {
    const result = await run([
      { id: 'a', jobName: 'fail' },
      { id: 'b', jobName: 'succeed', dependsOn: ['a'] },
      { id: 'other', jobName: 'succeed' },
      { id: 'after-other', jobName: 'succeed', dependsOn: ['other'] },
    ]);

    expect(result.state).toBe('failed');
    expect(result.stepResults['other'].state).toBe('completed');
    expect(result.stepResults['after-other'].state).toBe('completed');
    expect(result.stepResults['b'].state).toBe('skipped');
  });

  it('runs the dependents of a step its condition skipped', async () => {
    const result = await run([
      { id: 'a', jobName: 'succeed' },
      { id: 'b', jobName: 'succeed', dependsOn: ['a'], condition: () => false },
      { id: 'c', jobName: 'succeed', dependsOn: ['b'] },
    ]);

    expect(result.state).toBe('completed');
    expect(result.stepResults['b'].state).toBe('skipped');
    expect(result.stepResults['c'].state).toBe('completed');
  });

  it('runs the dependents of a failed step with continueOnError', async () => {
    const result = await run([
      { id: 'a', jobName: 'fail', continueOnError: true },
      { id: 'b', jobName: 'succeed', dependsOn: ['a'] },
      { id: 'c', jobName: 'succeed', dependsOn: ['b'] },
    ]);

    expect(result.stepResults['a'].state).toBe('failed');
    expect(result.stepResults['c'].state).toBe('completed');
  });

  it('tries a step whose job has no retry once', async () => {
    await run([{ id: 'a', jobName: 'fail' }]);

    expect(ran).toEqual(['fail']);
  });

  it("tries a step as many times as its job's retry says", async () => {
    await run([{ id: 'a', jobName: 'fail-twice-retried' }]);

    expect(ran).toEqual(['fail-twice-retried', 'fail-twice-retried']);
  });

  it("tries a step as many times as its own retry says, over its job's", async () => {
    await run([{ id: 'a', jobName: 'fail', retry: { maxAttempts: 2, backoffMs: 0 } }]);

    expect(ran).toEqual(['fail', 'fail']);
  });
});
