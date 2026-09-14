/**
 * A workflow step must satisfy the STEP JOB's own permissions
 * (GHSA-58v2-gpcc-jmqv).
 *
 * `JobExecutionManager` checks the workflow's permissions once, then the engine
 * runs each step through `job.create().execute()` directly. Without a check
 * here, a workflow that declares no permissions of its own launders every job
 * it references: an anonymous caller reaches an `admin`-only job by asking for
 * the workflow instead of the job.
 */
import type { JobEntry } from '../../../common/entries/job.entry';
import type { JobPermission } from '../../../common/metadata/job.metadata';
import type { WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { JobNotAuthorizedError } from '../../../errors';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { WorkflowStepExecutor } from '../workflow-step.executor';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
} as unknown as Parameters<typeof WorkflowStepExecutor.prototype.constructor>[1];

function jobEntry(name: string, permissions?: JobPermission[], execute = jest.fn()): JobEntry {
  return {
    name,
    metadata: { name, permissions },
    parseInput: (input: unknown) => input,
    create: () => ({ execute }),
  } as unknown as JobEntry;
}

function registryWith(job: JobEntry): JobRegistryInterface {
  return { findByName: (name: string) => (name === job.name ? job : undefined) } as unknown as JobRegistryInterface;
}

const step: WorkflowStep = { id: 'step-1', jobName: 'admin-only' } as WorkflowStep;

describe('WorkflowStepExecutor — step job permissions', () => {
  it('refuses a step whose job the caller may not execute', async () => {
    const execute = jest.fn();
    const job = jobEntry('admin-only', [{ action: 'execute', roles: ['admin'] }], execute);
    const executor = new WorkflowStepExecutor(registryWith(job), logger as never, { authInfo: {} });

    await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(JobNotAuthorizedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not retry a denial', async () => {
    // A permission failure is not transient. Running it through the retry loop
    // would delay the error by the full backoff and bury it behind attempt logs.
    const execute = jest.fn();
    const job = jobEntry('admin-only', [{ action: 'execute', roles: ['admin'] }], execute);
    const retried: WorkflowStep = { id: 'step-1', jobName: 'admin-only', retry: { maxAttempts: 3 } } as WorkflowStep;
    const executor = new WorkflowStepExecutor(registryWith(job), logger as never, { authInfo: {} });

    const started = Date.now();
    await expect(executor.executeStep(retried, {})).rejects.toBeInstanceOf(JobNotAuthorizedError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs the step when the caller holds the role the job requires', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true });
    const job = jobEntry('admin-only', [{ action: 'execute', roles: ['admin'] }], execute);
    const executor = new WorkflowStepExecutor(registryWith(job), logger as never, {
      authInfo: { user: { sub: 'u1', roles: ['admin'] } },
    });

    await expect(executor.executeStep(step, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
    expect(execute).toHaveBeenCalled();
  });

  it('runs a step whose job declares no permissions, keeping the documented fail-open', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true });
    const job = jobEntry('open', undefined, execute);
    const openStep: WorkflowStep = { id: 'step-1', jobName: 'open' } as WorkflowStep;
    const executor = new WorkflowStepExecutor(registryWith(job), logger as never, { authInfo: {} });

    await expect(executor.executeStep(openStep, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
  });
});
