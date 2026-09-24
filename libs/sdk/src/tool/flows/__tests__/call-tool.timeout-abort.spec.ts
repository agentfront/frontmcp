import 'reflect-metadata';

import { createTestFetchServer, rpc20260728 } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';
import type { WebFetchHandler } from '../../../transport/web-fetch-handler';

const TIMEOUT_MS = 100;
const WORK_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface DeployTracker {
  running: number;
  maxRunning: number;
  signalAbortedAfterWork: boolean[];
  pendingRuns: Array<Promise<void>>;
}

let deployServerCount = 0;

async function createDeployServer(): Promise<{ handler: WebFetchHandler; tracker: DeployTracker }> {
  deployServerCount += 1;
  const tracker: DeployTracker = { running: 0, maxRunning: 0, signalAbortedAfterWork: [], pendingRuns: [] };

  @Tool({
    name: 'deploy',
    inputSchema: {},
    timeout: { executeMs: TIMEOUT_MS },
    concurrency: { maxConcurrent: 1 },
  })
  class DeployTool extends ToolContext {
    async execute() {
      tracker.running += 1;
      tracker.maxRunning = Math.max(tracker.maxRunning, tracker.running);
      const work = sleep(WORK_MS);
      tracker.pendingRuns.push(work);
      await work;
      tracker.signalAbortedAfterWork.push(this.signal?.aborted === true);
      tracker.running -= 1;
      return { deployed: true };
    }
  }

  @App({ id: `ops-${deployServerCount}`, name: `ops-${deployServerCount}`, tools: [DeployTool] })
  class OpsApp {}

  const { handler } = await createTestFetchServer({
    info: { name: `timeout-abort-${deployServerCount}`, version: '1.0.0' },
    apps: [OpsApp],
    throttle: { enabled: true },
  });
  return { handler, tracker };
}

function callDeploy(handler: WebFetchHandler) {
  return rpc20260728(handler, 'tools/call', { name: 'deploy', arguments: {} });
}

async function createUpstreamCallServer(): Promise<{ handler: WebFetchHandler; upstreamSignals: AbortSignal[] }> {
  const upstreamSignals: AbortSignal[] = [];

  @Tool({ name: 'sync_orders', inputSchema: {}, timeout: { executeMs: TIMEOUT_MS } })
  class SyncOrdersTool extends ToolContext {
    async execute() {
      await this.fetch('https://upstream.example.com/orders');
      return { synced: true };
    }
  }

  @App({ id: 'orders-sync', name: 'orders-sync', tools: [SyncOrdersTool] })
  class OrdersSyncApp {}

  global.fetch = jest.fn((_input: RequestInfo | URL, options?: RequestInit) => {
    const signal = options?.signal;
    if (signal) upstreamSignals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  });

  const { handler } = await createTestFetchServer({
    info: { name: 'timeout-abort-upstream', version: '1.0.0' },
    apps: [OrdersSyncApp],
    throttle: { enabled: true },
  });
  return { handler, upstreamSignals };
}

describe('call-tool execution timeout', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('aborts the outbound this.fetch() of an execute() that passed its timeout', async () => {
    const { handler, upstreamSignals } = await createUpstreamCallServer();

    const { message } = await rpc20260728(handler, 'tools/call', { name: 'sync_orders', arguments: {} });

    expect(message.result?.['isError']).toBe(true);
    expect(upstreamSignals).toHaveLength(1);
    expect(upstreamSignals[0]?.aborted).toBe(true);
  });

  it('aborts this.signal of an execute() that passed its timeout', async () => {
    const { handler, tracker } = await createDeployServer();

    const { message } = await callDeploy(handler);
    await Promise.all(tracker.pendingRuns);
    await sleep(20);

    expect(message.result?.['isError']).toBe(true);
    expect(tracker.signalAbortedAfterWork).toEqual([true]);
  });

  it('never runs two execute() at once under maxConcurrent 1 when the first one timed out', async () => {
    const { handler, tracker } = await createDeployServer();

    await callDeploy(handler);
    await callDeploy(handler);
    await Promise.all(tracker.pendingRuns);
    await sleep(20);

    expect(tracker.maxRunning).toBe(1);
  });
});
