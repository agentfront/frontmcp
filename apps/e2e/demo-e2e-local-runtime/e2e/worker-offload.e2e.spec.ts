/**
 * E2E: a `worker: true` resource reads in a worker thread, so the server keeps answering while it runs; a read past
 * its budget is refused and the server stays healthy. Latency bounds are relative to the read's busy time, so a loaded
 * machine does not fail them.
 */
import { expect, test, type McpTestClient } from '@frontmcp/testing';

import { HEAVY_MS } from '../fixture/offload/spin';

interface Report {
  uri: string;
  isMainThread: boolean;
  turns: number;
}

/** Ping the server again and again until `work` settles; the round trip of each ping, in milliseconds. */
async function pingWhile(mcp: McpTestClient, work: Promise<unknown>): Promise<number[]> {
  let settled = false;
  void work.finally(() => (settled = true)).catch(() => undefined);
  const latencies: number[] = [];
  while (!settled) {
    const started = performance.now();
    const response = await mcp.raw.request({ jsonrpc: '2.0', id: `ping-${latencies.length}`, method: 'ping' });
    expect(response.error).toBeUndefined();
    latencies.push(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return latencies;
}

test.describe('worker offload', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-local-runtime/fixture/offload/main.ts',
    project: 'demo-e2e-local-runtime',
    publicMode: true,
  });

  test('answers pings while a worker: true resource reads, and blocks them while an inline one does', async ({
    mcp,
  }) => {
    await expect(mcp.resources.read('report://heavy')).resolves.toBeSuccessful();

    const offloaded = mcp.resources.read('report://heavy');
    const offloadedPings = await pingWhile(mcp, offloaded);
    const offloadedRead = await offloaded;
    const inline = mcp.resources.read('report://inline');
    const inlinePings = await pingWhile(mcp, inline);

    expect(offloadedRead).toBeSuccessful();
    expect(offloadedRead.json<Report>()).toMatchObject({ uri: 'report://heavy', isMainThread: false });
    expect((await inline).json<Report>()).toMatchObject({ uri: 'report://inline', isMainThread: true });
    expect(offloadedPings.length).toBeGreaterThan(3);
    expect(Math.max(...offloadedPings)).toBeLessThan(HEAVY_MS / 3);
    expect(Math.max(...inlinePings)).toBeGreaterThan(HEAVY_MS / 2);
  });

  test('refuses a read past its budget, then serves reads, tools and pings again', async ({ mcp }) => {
    const refused = await mcp.resources.read('report://stuck');

    expect(refused).toBeError();
    expect(refused.error?.message).toContain('ran past its 300 ms budget');

    const ping = await mcp.raw.request({ jsonrpc: '2.0', id: 'after-refusal', method: 'ping' });
    expect(ping.error).toBeUndefined();
    const heavy = await mcp.resources.read('report://heavy');
    expect(heavy.json<Report>()).toMatchObject({ isMainThread: false });
    const crunched = await mcp.tools.call('crunch', { ms: 50 });
    expect(crunched).toBeSuccessful();
    expect(crunched.json<{ turns: number }>().turns).toBeGreaterThan(0);
  });
});
