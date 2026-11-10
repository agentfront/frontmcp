/**
 * Smoke test of the local daemon example: a file dropped in the watched folder, and the scheduled summary, both reach
 * a local client that polls, on a server in public auth mode.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

interface PollResult {
  events: Array<{ name: string; data: Record<string, unknown> }>;
  cursor: string | null;
}

describe('Local daemon example', () => {
  let server: TestServer;
  let client: McpTestClient;
  let dropFolder: string;
  let nextRequestId = 1;

  beforeAll(async () => {
    dropFolder = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-daemon-'));
    server = await TestServer.start({
      project: 'demo-e2e-events-daemon',
      command: 'npx tsx apps/e2e/demo-e2e-events-daemon/src/main.ts',
      env: { DROP_FOLDER: dropFolder, SUMMARY_CRON: '* * * * * *' },
      startupTimeout: 30000,
      debug: false,
    });
    client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
    }).buildAndConnect();
  }, 60000);

  afterAll(async () => {
    if (client) await client.disconnect();
    if (server) await server.stop();
    if (dropFolder) await rm(dropFolder, { recursive: true, force: true });
  });

  /** One events/poll request; fails the test when it is refused. */
  async function poll(params: Record<string, unknown>): Promise<PollResult> {
    const reply = (await client.raw.request({
      jsonrpc: '2.0',
      id: `daemon-${nextRequestId++}`,
      method: 'events/poll',
      params,
    })) as { result?: PollResult; error?: { message: string } };
    if (!reply.result) throw new Error(`events/poll failed: ${reply.error?.message}`);
    return reply.result;
  }

  /** Polls from a cursor until an event arrives, for at most `timeoutMs`. */
  async function pollUntilEvents(params: Record<string, unknown>, cursor: string | null, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await poll({ ...params, cursor });
      if (result.events.length > 0 || Date.now() > deadline) return result;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('offers both events by poll and push, and not by webhook, on a server in public auth mode', async () => {
    const reply = (await client.raw.request({
      jsonrpc: '2.0',
      id: 'daemon-list',
      method: 'events/list',
      params: {},
    })) as {
      result?: { events: Array<{ name: string; delivery: string[] }> };
    };

    expect(reply.result?.events.map(({ name, delivery }) => ({ name, delivery }))).toEqual([
      { name: 'file.dropped', delivery: ['poll', 'push'] },
      { name: 'folder.summary', delivery: ['poll', 'push'] },
    ]);
  });

  it('tells a client that polls about a file dropped in the folder, filtered by its arguments', async () => {
    const pdfs = { name: 'file.dropped', arguments: { extension: '.pdf' } };
    const start = await poll(pdfs);
    await writeFile(path.join(dropFolder, 'notes.txt'), 'notes');
    await writeFile(path.join(dropFolder, 'invoice.pdf'), 'invoice');

    const result = await pollUntilEvents(pdfs, start.cursor);

    expect(result.events.map((occurrence) => occurrence.data)).toEqual([{ name: 'invoice.pdf', change: 'add' }]);
  });

  it('tells a client about the folder on the schedule of the duty', async () => {
    const start = await poll({ name: 'folder.summary' });

    const result = await pollUntilEvents({ name: 'folder.summary' }, start.cursor);

    expect(result.events[0].data).toEqual({ fileCount: expect.any(Number), at: expect.any(String) });
  });
});
