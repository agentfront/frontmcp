/**
 * E2E: `observability.stalls` names the call that blocked the event loop. A tool that busy-waits is named in the
 * stall warning; a call that failed earlier is not, because its failure took it out of the calls in flight. Work
 * outside a call is named by its work span: an `@HttpRoute` request, and a timer's work in a `trackWork()` span.
 */
import { expect, test } from '@frontmcp/testing';

const STALL_LINE = /Event loop stalled for (\d+) ms.*/;

async function stallLineNaming(logs: () => string[], entry: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = logs().find((logged) => STALL_LINE.test(logged) && logged.includes(entry));
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no stall warning named ${entry}; logs:\n${logs().join('\n')}`);
}

test.describe('Stall attribution', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-stalls.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('names a busy-waiting tool in the stall warning, and not a call that failed before it', async ({
    mcp,
    server,
  }) => {
    const failed = await mcp.tools.call('fail-fast', {});
    expect(failed).toBeError();
    // The failed call ends well before the stall begins, so only a call left in flight could be named.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const blocked = await mcp.tools.call('busy-wait', { ms: 600 });
    expect(blocked).toBeSuccessful();

    const line = await stallLineNaming(() => server.getLogs(), 'busy-wait');
    const stallMs = Number(STALL_LINE.exec(line)?.[1]);
    expect(stallMs).toBeGreaterThanOrEqual(590);
    expect(line).toMatch(/tools\/call stall-probe:busy-wait \(\d+ ms, session [0-9a-f]{12}\)/);
    expect(line).not.toContain('fail-fast');
    expect(line).not.toContain('"ms"');
  });

  test('names an @HttpRoute that busy-waits by its method and declared path', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/stall-probe/busy/600`);
    expect(response.status).toBe(200);

    const line = await stallLineNaming(() => server.getLogs(), 'GET /stall-probe/busy/:ms');
    expect(Number(STALL_LINE.exec(line)?.[1])).toBeGreaterThanOrEqual(590);
    expect(line).toMatch(/http GET \/stall-probe\/busy\/:ms \(\d+ ms\)/);
    expect(line).not.toContain('/busy/600');
  });

  test('names the trackWork() span of a timer that blocks after its call returned, and not the call', async ({
    mcp,
    server,
  }) => {
    const scheduled = await mcp.tools.call('later-busy-wait', { ms: 600 });
    expect(scheduled).toBeSuccessful();

    const line = await stallLineNaming(() => server.getLogs(), 'stall-probe:timer');
    expect(line).toMatch(/work stall-probe:timer \(\d+ ms\)/);
    expect(line).not.toContain('later-busy-wait');
  });
});
