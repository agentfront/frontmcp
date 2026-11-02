/**
 * E2E: hooks on one stage run lowest priority first, and a dev-mode server logs the order they resolve to.
 *
 * The hook-order app lists the setup gate (priority 10) before the feature gate (priority -10): the feature gate
 * still runs first. A server started with NODE_ENV=development logs that order once, on the flow's first run.
 */
import { expect, test } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-hooks/src/main.hook-order.ts';
const CALL_TOOL_ORDER = "Hook order of 'tools:call-tool' for 'hook-order'";
const EXECUTE_ORDER =
  '  execute: will FeatureGatePlugin.refuseDisabled (-10) → will SetupGatePlugin.requireSetup (10) → stage CallToolFlow.execute (0)';

const countOf = (logs: string[], text: string) => logs.join('\n').split(text).length - 1;

test.describe('Hook order E2E', () => {
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true });

  test('runs the hooks of two plugins on one stage lowest priority first', async ({ mcp }) => {
    const result = await mcp.tools.call('gate-order', {});

    expect(result).toBeSuccessful();
    expect(result.json<{ ran: string[] }>().ran).toEqual(['feature-gate', 'setup-gate']);
  });

  test('logs no hook order outside dev mode', async ({ mcp, server }) => {
    await mcp.tools.call('gate-order', {});

    expect(countOf(server.getLogs(), 'Hook order of')).toBe(0);
  });
});

test.describe('Hook order E2E in dev mode', () => {
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true, env: { NODE_ENV: 'development' } });

  test('logs the resolved order of the stage once', async ({ mcp, server }) => {
    await mcp.tools.call('gate-order', {});
    await mcp.tools.call('gate-order', {});

    const logs = server.getLogs();
    expect(countOf(logs, CALL_TOOL_ORDER)).toBe(1);
    expect(logs.join('\n')).toContain(EXECUTE_ORDER);
  });
});
