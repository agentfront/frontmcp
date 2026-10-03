/**
 * E2E for the @frontmcp/testing items of issue #680, against a real server process:
 *  - `test.beforeEach(async ({ mcp }) => …)` receives the test's fixtures instead of hanging on `done`
 *  - `test.use({ transport: 'sse' })` connects over the legacy HTTP+SSE transport
 */
import { expect, test, type McpTestClient } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-testing/src/main.ts';

test.describe('fixture hooks', () => {
  test.use({ server: SERVER, project: 'demo-e2e-testing', port: 0, publicMode: true });

  let clientInHook: McpTestClient | undefined;
  let toolsSeenInHook = 0;

  test.beforeEach(async ({ mcp }) => {
    clientInHook = mcp;
    toolsSeenInHook = (await mcp.tools.list()).length;
  });

  test.afterEach(async ({ mcp }) => {
    // Fixtures are torn down after afterEach hooks, so the client is still usable here
    expect(mcp.isConnected()).toBe(true);
  });

  test('beforeEach receives the same connected mcp client as the test', async ({ mcp }) => {
    expect(clientInHook).toBe(mcp);
    expect(toolsSeenInHook).toBeGreaterThan(0);
  });
});

test.describe('legacy SSE transport', () => {
  test.use({ server: SERVER, project: 'demo-e2e-testing', port: 0, publicMode: true, transport: 'sse' });

  test('lists and calls tools over HTTP+SSE', async ({ mcp }) => {
    expect(mcp.isConnected()).toBe(true);
    expect(mcp.sessionId).not.toBe('');
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('process-info');
    const result = await mcp.tools.call('process-info', {});
    expect(result).toBeSuccessful();
  });

  test('server.createClient can open another SSE client', async ({ server }) => {
    const other = await server.createClient({ transport: 'sse' });
    expect(other.isConnected()).toBe(true);
    expect((await other.tools.list()).length).toBeGreaterThan(0);
  });
});
