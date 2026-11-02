/**
 * E2E: a lazy app in a built server. `frontmcp build --target node` imports the lazy app to write
 * frontmcp.manifest.json next to the bundle; the bundle, run in production, finds the manifest there and lists the
 * app from it without importing it, and imports it on its first call.
 */
import * as path from 'path';

import { McpTestClient, TestServer } from '@frontmcp/testing';
import { ensureDir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { runFrontmcpCliAsync } from './helpers/exec-cli';

const SCRATCH_ROOT = path.resolve(__dirname, '..');
const BUILD_TIMEOUT_MS = 150_000;

interface Manifest {
  tools: Array<{ name: string; app?: string }>;
}

describe('frontmcp build with a lazy app', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-build-lazy-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'billing.app.ts'),
      `import { App, Tool, ToolContext } from '@frontmcp/sdk';

const marker = globalThis as { __lazyBillingImports?: number };
marker.__lazyBillingImports = (marker.__lazyBillingImports ?? 0) + 1;

@Tool({ name: 'charge', description: 'Charge a customer', inputSchema: {} })
class ChargeTool extends ToolContext {
  async execute() {
    return 'charged';
  }
}

@App({ id: 'billing', name: 'Billing', tools: [ChargeTool] })
export class BillingApp {}
`,
    );
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'billing_imports', description: 'How many times the billing module was imported', inputSchema: {} })
class BillingImportsTool extends ToolContext {
  async execute() {
    return { imports: (globalThis as { __lazyBillingImports?: number }).__lazyBillingImports ?? 0 };
  }
}

@App({ name: 'status', tools: [BillingImportsTool] })
class StatusApp {}

@FrontMcp({
  info: { name: 'Lazy Demo', version: '1.0.0' },
  apps: [StatusApp, { id: 'billing', name: 'Billing', lazy: () => import('./billing.app') }],
  http: { port: parseInt(process.env['PORT'] ?? '3000', 10) },
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn },
})
export default class Server {}
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = { name: 'lazy-demo', version: '1.0.0', entry: './src/main.ts', deployments: [{ target: 'node' }] };\n`,
    );
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('lists the lazy app from the manifest next to the bundle, and imports it on its first call', async () => {
    const build = await runFrontmcpCliAsync(['build', '--target', 'node'], projectDir, BUILD_TIMEOUT_MS);
    expect({ exitCode: build.exitCode, stderr: build.exitCode === 0 ? '' : build.stderr }).toEqual({
      exitCode: 0,
      stderr: '',
    });
    const manifest = JSON.parse(
      await readFile(path.join(projectDir, 'dist', 'node', 'frontmcp.manifest.json')),
    ) as Manifest;
    expect(manifest.tools).toContainEqual(expect.objectContaining({ name: 'charge', app: 'billing' }));

    const server = await TestServer.start({
      command: `node ${path.join(projectDir, 'dist', 'node', 'lazy-demo.bundle.js')}`,
      cwd: projectDir,
      env: { NODE_ENV: 'production', MCP_SESSION_SECRET: 'lazy-demo-e2e-session-secret-0123456789abcdef' },
      startupTimeout: 60_000,
    });
    let client: McpTestClient | undefined;
    try {
      const connected = await McpTestClient.create({ baseUrl: server.info.baseUrl }).buildAndConnect();
      client = connected;
      const imports = async () =>
        (await connected.tools.call('billing_imports', {})).json<{ imports: number }>().imports;

      expect((await connected.tools.list()).map((tool) => tool.name)).toContain('charge');
      expect(await imports()).toBe(0);
      expect((await connected.tools.call('charge', {})).text()).toContain('charged');
      expect(await imports()).toBe(1);
    } finally {
      await client?.disconnect();
      await server.stop();
    }
  }, 260_000);
});
