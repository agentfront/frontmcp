/**
 * E2E: `observability.stalls` names the call that blocked the event loop. A tool that busy-waits is named in the
 * stall warning; a call that failed earlier is not, because its failure took it out of the calls in flight.
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
    expect(stallMs).toBeGreaterThanOrEqual(600);
    expect(line).toMatch(/tools\/call stall-probe:busy-wait \(\d+ ms, session [0-9a-f]{12}\)/);
    expect(line).not.toContain('fail-fast');
    expect(line).not.toContain('"ms"');
  });
});
