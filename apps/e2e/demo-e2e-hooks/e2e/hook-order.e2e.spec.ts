/** E2E: hooks on one stage run lowest priority first, and only a dev-mode server logs the order they resolve to. */
import { expect, test } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-hooks/src/main.hook-order.ts';
const ANSWERED = 'gate-order answered';
const CALL_TOOL_ORDER = "Hook order of 'tools:call-tool' for 'hook-order'";
const EXECUTE_ORDER =
  '  execute: will FeatureGatePlugin.refuseDisabled (-10) → will SetupGatePlugin.requireSetup (10) → stage CallToolFlow.execute (0)';

const countOf = (logs: string, text: string) => logs.split(text).length - 1;

/** The server's logs once they hold `text` `times` times: what a call logs can reach the spec after its answer. */
async function logsWith(server: { getLogs(): string[] }, text: string, times: number): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const logs = server.getLogs().join('\n');
    if (countOf(logs, text) >= times) return logs;
    if (Date.now() > deadline) throw new Error(`The server logged '${text}' fewer than ${times} times`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test.describe('Hook order E2E', () => {
  // DEBUG=1 (which also shows the test servers' output) turns the print on: keep it off whatever the runner sets
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true, env: { NODE_ENV: 'test', DEBUG: '0' } });

  test('runs the hooks of two plugins on one stage lowest priority first', async ({ mcp }) => {
    const result = await mcp.tools.call('gate-order', {});

    expect(result).toBeSuccessful();
    expect(result.json<{ ran: string[] }>().ran).toEqual(['feature-gate', 'setup-gate']);
  });

  test('logs no hook order outside dev mode', async ({ mcp, server }) => {
    await mcp.tools.call('gate-order', {});

    expect(countOf(await logsWith(server, ANSWERED, 1), 'Hook order of')).toBe(0);
  });
});

test.describe('Hook order E2E in dev mode', () => {
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true, env: { NODE_ENV: 'development' } });

  test('logs the resolved order of the stage once', async ({ mcp, server }) => {
    await mcp.tools.call('gate-order', {});
    await mcp.tools.call('gate-order', {});

    const logs = await logsWith(server, ANSWERED, 2);
    expect(countOf(logs, CALL_TOOL_ORDER)).toBe(1);
    expect(logs).toContain(EXECUTE_ORDER);
  });
});
