/**
 * E2E Tests for ESM Hot-Reload (Version Polling)
 *
 * Tests the auto-update pipeline:
 * 1. Start with @test/esm-tools v1.0.0 (2 tools: echo, add)
 * 2. Publish v2.0.0 with 3 tools (echo, add, multiply) via /_admin/publish
 * 3. Wait for the VersionPoller to detect the new version
 * 4. Verify the new tool appears in tools/list
 * 5. Call the new tool to confirm it works
 *
 * Set DEBUG_E2E=1 for verbose logging.
 */
import { test, expect, TestServer } from '@frontmcp/testing';

const DEBUG = process.env['DEBUG_E2E'] === '1';
const log = DEBUG ? console.log.bind(console) : () => {};

// ESM package server instance
let esmServer: TestServer | null = null;

// Port configuration
const ESM_SERVER_PORT = 50411;

const V2_BUNDLE = `
module.exports = {
  default: {
    name: '@test/esm-tools',
    version: '2.0.0',
    tools: [
      {
        name: 'echo',
        description: 'Echoes the input message back',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: JSON.stringify(input) }],
        }),
      },
      {
        name: 'add',
        description: 'Adds two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: String(Number(input.a) + Number(input.b)) }],
        }),
      },
      {
        name: 'multiply',
        description: 'Multiplies two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: String(Number(input.a) * Number(input.b)) }],
        }),
      },
    ],
  },
};
`;

// Start local ESM package server before all tests
beforeAll(async () => {
  log(`[E2E] Starting ESM package server on port ${ESM_SERVER_PORT}...`);
  try {
    esmServer = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts',
      project: 'esm-package-server-hot-reload',
      port: ESM_SERVER_PORT,
      startupTimeout: 30000,
      healthCheckPath: '/@test/esm-tools',
      debug: DEBUG,
      env: { ESM_SERVER_PORT: String(ESM_SERVER_PORT) },
    });
    log('[E2E] ESM package server started:', esmServer.info.baseUrl);
    // Propagate actual port for the test fixture's MCP demo server
    process.env['ESM_SERVER_PORT'] = String(esmServer.info.port);
  } catch (error) {
    console.error('[E2E] Failed to start ESM package server:', error);
    throw error;
  }
}, 60000);

// Stop ESM package server after all tests
afterAll(async () => {
  delete process.env['ESM_SERVER_PORT'];
  if (esmServer) {
    log('[E2E] Stopping ESM package server...');
    await esmServer.stop();
    esmServer = null;
  }
}, 30000);

test.describe('ESM Hot-Reload E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-esm/src/main-hot-reload.ts',
    project: 'demo-e2e-esm-hot-reload',
    publicMode: true,
    logLevel: DEBUG ? 'debug' : 'warn',
    startupTimeout: 60000,
  });

  test('detects new version and registers new tools', async ({ mcp }) => {
    // Step 1: Verify initial state — only echo and add
    const initialTools = await mcp.tools.list();
    const initialNames = initialTools.map((t: { name: string }) => t.name);
    log('[TEST] Initial tools:', initialNames);

    expect(initialTools).toContainTool('esm:echo');
    expect(initialTools).toContainTool('esm:add');
    expect(initialNames).not.toContain('esm:multiply');

    // Step 2: Publish v2.0.0 with 3 tools (adds multiply)
    const publishUrl = `http://127.0.0.1:${esmServer!.info.port}/_admin/publish`;
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: '@test/esm-tools',
        version: '2.0.0',
        bundle: V2_BUNDLE,
      }),
    });
    expect(publishRes.ok).toBe(true);
    log('[TEST] Published v2.0.0');

    // Step 3: Poll tools/list until esm:multiply appears (max ~30s)
    let multiplyFound = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const tools = await mcp.tools.list();
      const names = tools.map((t: { name: string }) => t.name);
      log(`[TEST] Poll ${i + 1}: tools =`, names);
      if (names.includes('esm:multiply')) {
        multiplyFound = true;
        break;
      }
    }

    expect(multiplyFound).toBe(true);

    // Step 4: Call the new tool
    const result = await mcp.tools.call('esm:multiply', { a: 3, b: 4 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('12');
  });
});
