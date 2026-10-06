/**
 * `App.remote()` with `transportOptions.protocolVersion` (issue #680).
 *
 * The gateway proxies the same local server twice — `legacy:*` over the
 * session transports, `modern:*` over MCP 2026-07-28 — and lists every remote
 * entry once, including after the capability cache expires. A URI template
 * both remotes share is served by the first remote listed, `legacy`.
 */
import { expect, test, TestServer } from '@frontmcp/testing';

let localMcpServer: TestServer | null = null;
const gatewayEnv: Record<string, string> = { LOCAL_MCP_PORT: '50212' };

beforeAll(async () => {
  localMcpServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-remote/src/local-mcp-server/main.ts',
    project: 'demo-e2e-remote',
    port: 0,
    startupTimeout: 60000,
    healthCheckPath: '/',
  });
  gatewayEnv['LOCAL_MCP_PORT'] = String(localMcpServer.info.port);
}, 120000);

afterAll(async () => {
  await localMcpServer?.stop();
  localMcpServer = null;
}, 30000);

function connectionInfo(result: { json<T>(): T }): { session: boolean } {
  return result.json<{ session: boolean }>();
}

test.describe('App.remote() protocol revisions', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remote/src/main-2026.ts',
    project: 'demo-e2e-remote',
    port: 0,
    publicMode: true,
    startupTimeout: 60000,
    env: gatewayEnv,
  });

  test('a remote configured for 2026-07-28 is called without a session', async ({ mcp }) => {
    const result = await mcp.tools.call('modern:connection-info', {});
    expect(result).toBeSuccessful();
    expect(connectionInfo(result).session).toBe(false);
  });

  test('a remote left on the default revision is called through a session', async ({ mcp }) => {
    const result = await mcp.tools.call('legacy:connection-info', {});
    expect(result).toBeSuccessful();
    expect(connectionInfo(result).session).toBe(true);
  });

  test('a URI template both remotes share is listed once, from the first remote, also after re-discovery', async ({
    mcp,
  }) => {
    const names = async () => (await mcp.resources.listTemplates()).map((t) => t.name).sort();

    expect(await names()).toEqual(['legacy:item']);
    // cacheTTL is 200ms: the next listing re-discovers both remotes, and the first one listed keeps the template.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await names()).toEqual(['legacy:item']);
  });

  test('each remote tool is listed once, also after re-discovery', async ({ mcp }) => {
    const count = async (name: string) => (await mcp.tools.list()).filter((t) => t.name === name).length;

    expect(await count('modern:connection-info')).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await count('modern:connection-info')).toBe(1);
    expect(await count('legacy:connection-info')).toBe(1);
  });
});
