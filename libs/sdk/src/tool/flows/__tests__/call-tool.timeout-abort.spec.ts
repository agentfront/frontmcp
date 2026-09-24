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

describe('call-tool execution timeout', () => {
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
