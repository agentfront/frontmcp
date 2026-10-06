/**
 * On Node (and any runtime with native async context) the engine keeps running ready steps in
 * parallel, up to `maxConcurrency`: only a runtime without `AsyncContext` runs them one at a time
 * (see `workflow.engine.browser-context.spec.ts`).
 */
import type { JobEntry } from '../../../common/entries/job.entry';
import type { WorkflowMetadata } from '../../../common/metadata/workflow.metadata';
import { getCallSurface } from '../../../context/call-surface';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { WorkflowEngine } from '../workflow.engine';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowEngine>[2];

describe('WorkflowEngine with native async context', () => {
  it('runs independent steps in parallel, each on the job surface', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const surfaces: Array<string | undefined> = [];
    const names = ['fetch-a', 'fetch-b', 'fetch-c'];
    const jobs = new Map<string, JobEntry>(
      names.map((name) => [
        name,
        {
          name,
          metadata: { name },
          parseInput: (input: unknown) => input,
          parseOutput: (output: unknown) => output,
          create: () => ({
            loadAuthContext: async () => undefined,
            execute: async () => {
              inFlight++;
              maxInFlight = Math.max(maxInFlight, inFlight);
              await new Promise((resolve) => setTimeout(resolve, 30));
              surfaces.push(getCallSurface());
              inFlight--;
              return {};
            },
          }),
        } as unknown as JobEntry,
      ]),
    );
    const registry = { findByName: (name: string) => jobs.get(name) } as unknown as JobRegistryInterface;
    const metadata = {
      name: 'fan-out',
      steps: names.map((name) => ({ id: name, jobName: name })),
    } as unknown as WorkflowMetadata;

    const result = await new WorkflowEngine(metadata, registry, logger, { authInfo: {} }).execute({});

    expect(result.state).toBe('completed');
    expect(maxInFlight).toBe(3);
    expect(surfaces).toEqual(['job', 'job', 'job']);
  });
});
