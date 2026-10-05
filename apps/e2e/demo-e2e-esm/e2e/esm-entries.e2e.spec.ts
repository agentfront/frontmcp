/** Per-entry `.esm()` entries and a package specifier string, loaded from the local ESM package server. */
import { expect, test, TestServer } from '@frontmcp/testing';

const ESM_SERVER_PORT = 50401;

let esmServer: TestServer | null = null;

beforeAll(async () => {
  esmServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts',
    project: 'esm-package-server',
    port: ESM_SERVER_PORT,
    startupTimeout: 30000,
    healthCheckPath: '/@test/esm-tools',
    env: { ESM_SERVER_PORT: String(ESM_SERVER_PORT) },
  });
  process.env['ESM_SERVER_PORT'] = String(esmServer.info.port);
}, 60000);

afterAll(async () => {
  delete process.env['ESM_SERVER_PORT'];
  await esmServer?.stop();
  esmServer = null;
}, 30000);

test.describe('Per-entry .esm() loading E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-esm/src/main-entries.ts',
    project: 'demo-e2e-esm',
    publicMode: true,
    startupTimeout: 60000,
  });

  test('lists each entry under its own name, with no namespace', async ({ mcp }) => {
    const names = (await mcp.tools.list()).map((tool) => tool.name).sort();

    expect(names).toEqual(['decorated_echo', 'echo', 'greet', 'sum']);
  });

  test('calls a plain-object tool from the package', async ({ mcp }) => {
    const result = await mcp.tools.call('echo', { message: 'hello' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent(JSON.stringify({ message: 'hello' }));
  });

  test('applies options.metadata to the loaded tool', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools.find((tool) => tool.name === 'sum')?.description).toBe('Adds two numbers, loaded per entry');

    const result = await mcp.tools.call('sum', { a: 2, b: 3 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('5');
  });

  test('calls a renamed decorated tool class from the package', async ({ mcp }) => {
    const result = await mcp.tools.call('decorated_echo', { message: 'hi' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('hi');
  });

  test('reads a Resource.esm() entry and gets a Prompt.esm() entry', async ({ mcp }) => {
    const resource = await mcp.resources.read('esm://status');
    expect(resource).toBeSuccessful();
    expect(resource).toHaveTextContent('esm-multi');

    const prompt = await mcp.prompts.get('greeting-prompt', { name: 'Ada' });
    expect(prompt).toBeSuccessful();
    expect(prompt.messages[0]?.content).toEqual({ type: 'text', text: 'Please greet Ada warmly.' });
  });
});
