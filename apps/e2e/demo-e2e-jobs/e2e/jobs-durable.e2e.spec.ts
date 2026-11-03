/**
 * E2E: durable job runs (proposal 2.2 a) on a server whose jobs live in its top-level SQLite store and
 * are admitted one at a time: `cancel_job` aborts a run and its cleanup runs, a timeout ends a run as
 * `timed_out`, an attempt that waits past the admission cap is refused with a remedy, and a subscriber
 * to `job://runs/{runId}` hears `notifications/resources/updated` as the run progresses.
 */
import * as os from 'node:os';

import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { pathJoin } from '@frontmcp/utils';

const RESOURCE_UPDATED = 'notifications/resources/updated';

interface RunHandle {
  runId: string;
  state: string;
  uri: string;
}

interface RunStatus {
  runId: string;
  state: string;
  attempt: number;
  error?: { name: string; message: string };
}

async function until(condition: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function durableLog(mcp: McpTestClient): Promise<string[]> {
  return (await mcp.tools.call('get-durable-log', {})).json<{ entries: string[] }>().entries;
}

async function status(mcp: McpTestClient, runId: string): Promise<RunStatus> {
  return (await mcp.tools.call('get_job_status', { runId })).json<RunStatus>();
}

async function settled(mcp: McpTestClient, runId: string): Promise<RunStatus> {
  let current = await status(mcp, runId);
  await until(async () => {
    current = await status(mcp, runId);
    return !['pending', 'running', 'retrying'].includes(current.state);
  }, `run ${runId} to settle`);
  return current;
}

async function start(mcp: McpTestClient, name: string, input: Record<string, unknown>): Promise<RunHandle> {
  const result = await mcp.tools.call('execute_job', { name, input, background: true });
  expect(result).toBeSuccessful();
  return result.json<RunHandle>();
}

test.describe('Durable jobs E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-jobs/src/main.durable.ts',
    project: 'demo-e2e-jobs',
    publicMode: true,
    env: { JOBS_SQLITE_PATH: pathJoin(os.tmpdir(), `frontmcp-e2e-durable-jobs-${process.pid}.sqlite`) },
  });

  test('a background run answers at once with its job://runs handle', async ({ mcp }) => {
    const handle = await start(mcp, 'answer-now', {});

    expect(handle).toEqual({ runId: expect.any(String), state: 'pending', uri: `job://runs/${handle.runId}` });
    expect((await settled(mcp, handle.runId)).state).toBe('completed');
  });

  test('cancel_job cancels a running run and its cleanup runs', async ({ mcp }) => {
    const handle = await start(mcp, 'wait-for-cancel', { tag: 'cancel-me' });
    await until(async () => (await durableLog(mcp)).includes('cancel-me:started'), 'the job to start');

    const cancelled = await mcp.tools.call('cancel_job', { runId: handle.runId });

    expect(cancelled).toBeSuccessful();
    expect(cancelled.json()).toEqual({ runId: handle.runId, state: 'cancelled' });
    await until(async () => (await durableLog(mcp)).includes('cancel-me:cancel'), 'the cleanup to run');
    expect((await settled(mcp, handle.runId)).state).toBe('cancelled');
  });

  test('cancel_job refuses a finished run with a remedy, and an unknown one', async ({ mcp }) => {
    const handle = await start(mcp, 'answer-now', {});
    await settled(mcp, handle.runId);

    const finished = await mcp.tools.call('cancel_job', { runId: handle.runId });
    expect(finished).toBeError('JOB_RUN_FINISHED');
    expect(finished.raw._meta?.['remedy']).toEqual(
      expect.objectContaining({ tool: 'get_job_status', args: { runId: handle.runId } }),
    );

    const unknown = await mcp.tools.call('cancel_job', { runId: 'no-such-run' });
    expect(unknown).toBeError('JOB_RUN_NOT_FOUND');
    expect(unknown.raw._meta?.['remedy']).toEqual(expect.objectContaining({ say: expect.any(String) }));
  });

  test('a run that outlasts its timeout ends as timed_out after its cleanup', async ({ mcp }) => {
    const handle = await start(mcp, 'outlast-timeout', { tag: 'too-slow' });

    const run = await settled(mcp, handle.runId);

    expect(run.state).toBe('timed_out');
    expect(run.error?.name).toBe('JobTimeoutError');
    expect(await durableLog(mcp)).toEqual(expect.arrayContaining(['too-slow:started', 'too-slow:timeout']));
  });

  test('an attempt that waits past the admission cap is refused with a remedy', async ({ mcp }) => {
    const busy = await start(mcp, 'wait-for-cancel', { tag: 'holds-the-slot' });
    await until(async () => (await durableLog(mcp)).includes('holds-the-slot:started'), 'the job to start');

    const refused = await mcp.tools.call('execute_job', { name: 'answer-now', input: {} });

    expect(refused).toBeError('JOB_ADMISSION_TIMEOUT');
    expect(refused.raw._meta?.['remedy']).toEqual(expect.objectContaining({ say: expect.any(String) }));
    expect(await mcp.tools.call('cancel_job', { runId: busy.runId })).toBeSuccessful();
    await settled(mcp, busy.runId);
    expect(await mcp.tools.call('execute_job', { name: 'answer-now', input: {} })).toBeSuccessful();
  });

  test('a subscriber to job://runs/{runId} hears each progress update and reads the final run', async ({ mcp }) => {
    const handle = await start(mcp, 'report-progress', {});
    await mcp.raw.request({
      jsonrpc: '2.0',
      id: 'subscribe',
      method: 'resources/subscribe',
      params: { uri: handle.uri },
    });
    const updatesFor = () =>
      mcp.notifications
        .collect()
        .received.filter(
          ({ method, params }) => method === RESOURCE_UPDATED && (params as { uri?: string })?.uri === handle.uri,
        );

    await settled(mcp, handle.runId);
    await until(async () => updatesFor().length >= 2, 'resources/updated notifications');

    const read = await mcp.resources.read(handle.uri);
    expect(read.json()).toEqual(
      expect.objectContaining({
        runId: handle.runId,
        state: 'completed',
        result: { steps: 3 },
        progress: { progress: 3, total: 3, message: 'step 3' },
      }),
    );
  });
});
