/**
 * On Node (and any runtime with native async context) the engine keeps running ready steps in
 * parallel, up to `maxConcurrency`: only a runtime without `AsyncContext` runs them one at a time
 * (see `workflow.engine.browser-context.spec.ts`). Each step attempt runs the `jobs:execute-job` flow
 * (#700), and its job runs on the `'job'` surface.
 */
import 'reflect-metadata';

import { App, Job, JobContext, LogLevel } from '../../../common';
import type { WorkflowMetadata } from '../../../common/metadata/workflow.metadata';
import { getCallSurface } from '../../../context/call-surface';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type Scope } from '../../../scope/scope.instance';
import { WorkflowEngine } from '../workflow.engine';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as ConstructorParameters<typeof WorkflowEngine>[2];

let inFlight = 0;
let maxInFlight = 0;
const surfaces: Array<string | undefined> = [];

abstract class SlowFetch extends JobContext {
  async execute() {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    surfaces.push(getCallSurface());
    inFlight--;
    return {};
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

describe('WorkflowEngine with native async context', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-engine-concurrency', version: '1.0.0' },
      apps: [FanOutApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('runs independent steps in parallel, each on the job surface', async () => {
    const registry = (server as unknown as { scope: Scope }).scope.jobs;
    if (!registry) throw new Error('jobs are not enabled');
    const names = ['fetch-a', 'fetch-b', 'fetch-c'];
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
