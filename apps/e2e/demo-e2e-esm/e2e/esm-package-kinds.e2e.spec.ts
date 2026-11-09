/**
 * E2E Tests for every kind of entry an ESM package exports
 *
 * `@test/esm-full` (fixtures/full-package.ts) exports a provider, a tool that injects it, a skill, an agent, a job and
 * a workflow. Through a real server loading it from the local package server, each is served as a local app's is.
 *
 * Set DEBUG_E2E=1 for verbose logging.
 */
import { expect, test, TestServer } from '@frontmcp/testing';

const DEBUG = process.env['DEBUG_E2E'] === '1';

let esmServer: TestServer | null = null;

const ESM_SERVER_PORT = 50412;

beforeAll(async () => {
  esmServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts',
    project: 'esm-package-server-kinds',
    port: ESM_SERVER_PORT,
    startupTimeout: 30000,
    healthCheckPath: '/@test/esm-full',
    debug: DEBUG,
    env: { ESM_SERVER_PORT: String(ESM_SERVER_PORT) },
  });
  process.env['ESM_SERVER_PORT'] = String(esmServer.info.port);
}, 60000);

afterAll(async () => {
  delete process.env['ESM_SERVER_PORT'];
  await esmServer?.stop();
  esmServer = null;
}, 30000);

test.describe('ESM package entry kinds E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-esm/src/main.ts',
    project: 'demo-e2e-esm-kinds',
    publicMode: true,
    logLevel: DEBUG ? 'debug' : 'warn',
    startupTimeout: 60000,
  });

  test("a package tool injects the package's provider", async ({ mcp }) => {
    const result = await mcp.tools.call('full:greet', { name: 'Ada' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('Hello, Ada, from 1.0.0');
  });

  test('a package agent is listed and called as its invoke_ tool', async ({ mcp }) => {
    expect(await mcp.tools.list()).toContainTool('invoke_concierge');

    const result = await mcp.tools.call('invoke_concierge', { name: 'Grace' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('The concierge says: Hello, Grace, from 1.0.0');
  });

  test('a package skill is listed and read as a skill:// resource', async ({ mcp }) => {
    expect(await mcp.resources.list()).toContainResource('skill://welcome/SKILL.md');

    const content = await mcp.resources.read('skill://welcome/SKILL.md');

    expect(content).toHaveTextContent('Greet the user with the greet tool.');
  });

  test('a package job runs in the server job system', async ({ mcp }) => {
    const result = await mcp.tools.call('execute_job', { name: 'welcome-batch', input: { names: ['Ada', 'Grace'] } });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('completed');
    expect(result).toHaveTextContent('"greeted":2');
  });

  test('a package workflow runs its steps over the package jobs', async ({ mcp }) => {
    const result = await mcp.tools.call('execute_workflow', { name: 'welcome-flow' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('completed');
  });
});
