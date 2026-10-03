/**
 * A browser build resolves `AsyncLocalStorage` to `@frontmcp/utils`' browser implementation
 * (`#async-context` → `browser-async-context.ts`). Without TC39 `AsyncContext` it cannot tell apart
 * two runs that overlap inside one request, so it refuses to answer instead of guessing
 * (`AsyncContextOverlapError`). Each workflow step runs its job on the `'job'` call surface, one such
 * run, so steps the engine started together failed and were retried (1 s, then 2 s backoff) until
 * they happened not to overlap: a workflow of 0.1 s steps took about 3 s.
 *
 * Without `AsyncContext` the engine now runs ready steps one after another, so each step runs once,
 * on its own surface, and the workflow takes about the sum of its steps.
 */
import type { JobEntry } from '../../../common/entries/job.entry';
import type { WorkflowMetadata } from '../../../common/metadata/workflow.metadata';
import { getCallSurface } from '../../../context/call-surface';
import type { JobRegistryInterface } from '../../../job/job.registry';
import { WorkflowEngine } from '../workflow.engine';

jest.mock('#async-context', () => jest.requireActual('../../../../../utils/src/async-context/browser-async-context'));

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowEngine>[2];

interface Probe {
  executions: number;
  inFlight: number;
  maxInFlight: number;
  surfaces: Array<string | undefined>;
}

function registryOf(probe: Probe, names: string[], ms: number): JobRegistryInterface {
  const jobs = new Map<string, JobEntry>(
    names.map((name) => [
      name,
      {
        name,
        metadata: { name },
        parseInput: (input: unknown) => input,
        create: () => ({
          loadAuthContext: async () => undefined,
          execute: async () => {
            probe.executions++;
            probe.inFlight++;
            probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
            try {
              await new Promise((resolve) => setTimeout(resolve, ms));
              probe.surfaces.push(getCallSurface());
              return { job: name };
            } finally {
              probe.inFlight--;
            }
          },
        }),
      } as unknown as JobEntry,
    ]),
  );
  return { findByName: (name: string) => jobs.get(name) } as unknown as JobRegistryInterface;
}

describe('WorkflowEngine without AsyncContext (browser build)', () => {
  it('runs independent steps once each, one after another, each on the job surface', async () => {
    const probe: Probe = { executions: 0, inFlight: 0, maxInFlight: 0, surfaces: [] };
    const names = ['fetch-a', 'fetch-b', 'fetch-c'];
    const metadata = {
      name: 'fan-out',
      steps: names.map((name) => ({ id: name, jobName: name })),
    } as unknown as WorkflowMetadata;
    const engine = new WorkflowEngine(metadata, registryOf(probe, names, 50), logger, { authInfo: {} });

    const result = await engine.execute({});

    expect({
      state: result.state,
      steps: Object.fromEntries(Object.entries(result.stepResults).map(([id, step]) => [id, step.state])),
      executions: probe.executions,
      maxInFlight: probe.maxInFlight,
      surfaces: probe.surfaces,
    }).toEqual({
      state: 'completed',
      steps: { 'fetch-a': 'completed', 'fetch-b': 'completed', 'fetch-c': 'completed' },
      executions: 3,
      maxInFlight: 1,
      surfaces: ['job', 'job', 'job'],
    });
    // No step failed and waited out a retry backoff (the first one is 1 s).
    expect(result.completedAt - result.startedAt).toBeLessThan(900);
  });
});
