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
import 'reflect-metadata';

import { App, Job, JobContext, LogLevel } from '../../../common';
import type { WorkflowMetadata } from '../../../common/metadata/workflow.metadata';
import { getCallSurface } from '../../../context/call-surface';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type Scope } from '../../../scope/scope.instance';
import { WorkflowEngine } from '../workflow.engine';

jest.mock('#async-context', () => jest.requireActual('../../../../../utils/src/async-context/browser-async-context'));

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowEngine>[2];

const probe = { executions: 0, inFlight: 0, maxInFlight: 0, surfaces: [] as Array<string | undefined> };

abstract class SlowFetch extends JobContext {
  async execute() {
    probe.executions++;
    probe.inFlight++;
    probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      probe.surfaces.push(getCallSurface());
      return {};
    } finally {
      probe.inFlight--;
    }
  }
}

@Job({ name: 'fetch-a', inputSchema: {}, outputSchema: {} })
class FetchA extends SlowFetch {}

@Job({ name: 'fetch-b', inputSchema: {}, outputSchema: {} })
class FetchB extends SlowFetch {}

@Job({ name: 'fetch-c', inputSchema: {}, outputSchema: {} })
class FetchC extends SlowFetch {}

@App({ id: 'fan-out', name: 'Fan out', jobs: [FetchA, FetchB, FetchC] })
class FanOutApp {}

describe('WorkflowEngine without AsyncContext (browser build)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-engine-browser-context', version: '1.0.0' },
      apps: [FanOutApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('runs independent steps once each, one after another, each on the job surface', async () => {
    const registry = (server as unknown as { scope: Scope }).scope.jobs;
    if (!registry) throw new Error('jobs are not enabled');
    const names = ['fetch-a', 'fetch-b', 'fetch-c'];
    const metadata = {
      name: 'fan-out',
      steps: names.map((name) => ({ id: name, jobName: name })),
    } as unknown as WorkflowMetadata;
    const engine = new WorkflowEngine(metadata, registry, logger, { authInfo: {} });

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
