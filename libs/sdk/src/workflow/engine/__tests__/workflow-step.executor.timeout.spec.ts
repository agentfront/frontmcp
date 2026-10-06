/**
 * A workflow step's timeout bounds the whole attempt, including the `authorities.pipes` that load
 * the step's `this.auth`: a hung pipe fails the attempt with `WorkflowJobTimeoutError`, and the
 * retry loop then runs the next attempt.
 */
import type { JobEntry } from '../../../common/entries/job.entry';
import type { WorkflowStep } from '../../../common/metadata/workflow.metadata';
import { WorkflowJobTimeoutError } from '../../../errors/workflow.errors';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { WorkflowStepExecutor } from '../workflow-step.executor';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowStepExecutor>[1];

function jobWithAuthLoads(loads: Array<() => Promise<void>>, execute: jest.Mock): JobEntry {
  let attempt = 0;
  return {
    name: 'piped',
    metadata: { name: 'piped' },
    parseInput: (input: unknown) => input,
    parseOutput: (output: unknown) => output,
    create: () => ({ loadAuthContext: loads[attempt++], execute }),
  } as unknown as JobEntry;
}

function registryWith(job: JobEntry): JobRegistryInterface {
  return { findByName: (name: string) => (name === job.name ? job : undefined) } as unknown as JobRegistryInterface;
}

const hang = () => new Promise<void>(() => undefined);

describe('WorkflowStepExecutor — step timeout', () => {
  it('times out an attempt whose auth pipes never settle', async () => {
    const execute = jest.fn();
    const job = jobWithAuthLoads([hang], execute);
    const step = { id: 'step-1', jobName: 'piped', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
    const executor = new WorkflowStepExecutor(registryWith(job), logger, { authInfo: {} });

    await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('retries after an attempt whose auth pipes timed out', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true });
    const job = jobWithAuthLoads([hang, async () => undefined], execute);
    const step = {
      id: 'step-1',
      jobName: 'piped',
      timeout: 20,
      retry: { maxAttempts: 2, backoffMs: 1 },
    } as WorkflowStep;
    const executor = new WorkflowStepExecutor(registryWith(job), logger, { authInfo: {} });

    await expect(executor.executeStep(step, {})).resolves.toEqual({ outputs: { ok: true }, state: 'completed' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not start the job when its auth pipes settle after the attempt timed out', async () => {
    let finishAuthLoad: () => void = () => undefined;
    const lateLoad = () => new Promise<void>((resolve) => (finishAuthLoad = resolve));
    const execute = jest.fn();
    const job = jobWithAuthLoads([lateLoad], execute);
    const step = { id: 'step-1', jobName: 'piped', timeout: 20, retry: { maxAttempts: 1 } } as WorkflowStep;
    const executor = new WorkflowStepExecutor(registryWith(job), logger, { authInfo: {} });

    await expect(executor.executeStep(step, {})).rejects.toBeInstanceOf(WorkflowJobTimeoutError);
    finishAuthLoad();
    await new Promise((resolve) => setImmediate(resolve));

    expect(execute).not.toHaveBeenCalled();
  });
});
