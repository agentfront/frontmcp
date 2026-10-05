/** Per-entry `.remote()` entries proxying single entries of the local MCP server. */
import { expect, test, TestServer } from '@frontmcp/testing';

let localMcpServer: TestServer | null = null;
const gatewayEnv: Record<string, string> = { LOCAL_MCP_PORT: '50213' };

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

test.describe('Per-entry .remote() loading E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remote/src/main-entries.ts',
    project: 'demo-e2e-remote',
    port: 0,
    publicMode: true,
    startupTimeout: 60000,
    env: gatewayEnv,
  });

  test('lists only the named entries, under their own names', async ({ mcp }) => {
    const tools = (await mcp.tools.list()).map((tool) => tool.name).sort();
    const prompts = (await mcp.prompts.list()).map((prompt) => prompt.name);

    expect(tools).toEqual(['echo', 'sum']);
    expect(prompts).toEqual(['greeting']);
  });

  test('proxies a tool call to the remote server', async ({ mcp }) => {
    const result = await mcp.tools.call('echo', { message: 'over the wire' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('over the wire');
  });

  test('calls a renamed remote tool by its new name', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools.find((tool) => tool.name === 'sum')?.description).toBe('Adds two numbers on the local server');

    const result = await mcp.tools.call('sum', { a: 2, b: 3 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('2 + 3 = 5');
  });

  test('reads the remote resource and gets the remote prompt', async ({ mcp }) => {
    const resource = await mcp.resources.read('test://status');
    expect(resource).toBeSuccessful();
    expect(resource).toHaveTextContent('healthy');

    const prompt = await mcp.prompts.get('greeting', { name: 'Ada' });
    expect(prompt).toBeSuccessful();
    expect(prompt.messages.length).toBeGreaterThan(0);
  });
});
