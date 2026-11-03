/**
 * E2E: lazy apps (`apps: [{ name, lazy: () => import('./billing.app') }]`).
 *
 * `src/lazy/write-manifest.ts` writes the server's frontmcp.manifest.json, as `frontmcp build` does. In production the
 * server lists the billing app from it without importing the module, whose import counts itself in a global the
 * status app's `billing_imports` reads; the first call imports it, once. Without a manifest, development imports the
 * app at startup and production does not start.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, test, TestServer, type McpTestClient } from '@frontmcp/testing';
import { mkdtemp, rm, runCmd } from '@frontmcp/utils';

const SERVER = 'apps/e2e/demo-e2e-multiapp/src/lazy/lazy.main.ts';

let manifestDir: string | undefined;
const productionEnv: Record<string, string> = {
  NODE_ENV: 'production',
  MCP_SESSION_SECRET: 'lazy-apps-e2e-session-secret-0123456789abcdef',
};

beforeAll(async () => {
  manifestDir = await mkdtemp(path.join(os.tmpdir(), 'lazy-apps-e2e-'));
  const manifest = path.join(manifestDir, 'frontmcp.manifest.json');
  await runCmd('npx', ['tsx', 'apps/e2e/demo-e2e-multiapp/src/lazy/write-manifest.ts', manifest]);
  productionEnv['LAZY_APPS_MANIFEST'] = manifest;
}, 120000);

afterAll(async () => {
  if (manifestDir) await rm(manifestDir, { recursive: true, force: true });
});

async function billingImports(mcp: McpTestClient): Promise<number> {
  return (await mcp.tools.call('billing_imports', {})).json<{ imports: number }>().imports;
}

test.describe('Lazy apps from frontmcp.manifest.json E2E', () => {
  test.use({ server: SERVER, project: 'demo-e2e-multiapp', publicMode: true, env: productionEnv });

  test('lists the lazy app without importing it', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const resources = await mcp.resources.list();

    expect(tools).toContainTool('charge');
    expect(tools.find((tool) => tool.name === 'charge')?.inputSchema).toEqual(
      expect.objectContaining({ required: ['customer', 'cents'] }),
    );
    expect(resources.map((resource) => resource.uri)).toContain('billing://plans');
    expect(await billingImports(mcp)).toBe(0);
  });

  test('imports the app on its first call, once for concurrent calls', async ({ mcp }) => {
    const results = await Promise.all(
      ['acme', 'globex', 'initech'].map((customer) => mcp.tools.call('charge', { customer, cents: 100 })),
    );

    for (const result of results) expect(result).toBeSuccessful();
    expect(results[1]).toHaveTextContent('R-globex');
    expect(await billingImports(mcp)).toBe(1);

    const plans = await mcp.resources.read('billing://plans');
    expect(plans).toHaveTextContent('pro');
    expect(await billingImports(mcp)).toBe(1);
  });
});

test.describe('Lazy apps without a manifest in development E2E', () => {
  test.use({ server: SERVER, project: 'demo-e2e-multiapp', publicMode: true, env: { NODE_ENV: 'development' } });

  test('imports the app at startup', async ({ mcp }) => {
    expect(await billingImports(mcp)).toBe(1);
    expect(await mcp.tools.list()).toContainTool('charge');
  });
});

describe('Lazy apps without a manifest in production E2E', () => {
  it('does not start, and says how to fix it', async () => {
    const outcome = await TestServer.start({
      command: `npx tsx ${SERVER}`,
      project: 'demo-e2e-multiapp',
      env: { NODE_ENV: 'production', MCP_SESSION_SECRET: productionEnv['MCP_SESSION_SECRET'] },
      startupTimeout: 60000,
    }).then(
      async (server) => {
        await server.stop();
        return 'started';
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(outcome).toMatch(/App "billing" is lazy, and no frontmcp\.manifest\.json was found/);
    expect(outcome).toMatch(/frontmcp build/);
  });
});
