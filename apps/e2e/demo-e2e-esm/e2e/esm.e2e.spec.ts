/**
 * E2E Tests for ESM Package Loading
 *
 * Tests the full ESM loading pipeline through a real FrontMCP runtime:
 * @FrontMcp config → AppRegistry → AppEsmInstance → EsmModuleLoader
 *   → fetch from local server → cache → normalize → register → tools/list → tools/call
 *
 * Uses a local HTTP server (esm-package-server) as a custom ESM registry,
 * simulating an on-premise esm.sh. No real network calls — everything hits 127.0.0.1.
 *
 * Set DEBUG_E2E=1 environment variable for verbose logging.
 */
import { test, expect, TestServer } from '@frontmcp/testing';

const DEBUG = process.env['DEBUG_E2E'] === '1';
const log = DEBUG ? console.log.bind(console) : () => {};

// ESM package server instance
let esmServer: TestServer | null = null;

// Port configuration
const ESM_SERVER_PORT = 50400;

// Start local ESM package server before all tests
beforeAll(async () => {
  log(`[E2E] Starting ESM package server on port ${ESM_SERVER_PORT}...`);
  try {
    esmServer = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts',
      project: 'esm-package-server',
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

test.describe('ESM Package Loading E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-esm/src/main.ts',
    project: 'demo-e2e-esm',
    publicMode: true,
    logLevel: DEBUG ? 'debug' : 'warn',
    startupTimeout: 60000,
  });

  // ═══════════════════════════════════════════════════════════════
  // CONNECTIVITY
  // ═══════════════════════════════════════════════════════════════

  test('should connect to ESM gateway server', async ({ mcp }) => {
    expect(mcp.isConnected()).toBe(true);
    expect(mcp.serverInfo.name).toBe('Demo E2E ESM');
  });

  // ═══════════════════════════════════════════════════════════════
  // TOOL DISCOVERY
  // ═══════════════════════════════════════════════════════════════

  test('lists ESM-loaded tools from esm-tools package', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    log(
      '[TEST] Found tools:',
      tools.map((t: unknown) => {
        if (typeof t === 'object' && t !== null && 'name' in t) {
          return (t as { name: string }).name;
        }
        return String(t);
      }),
    );

    expect(tools).toContainTool('esm:echo');
    expect(tools).toContainTool('esm:add');
  });

  test('lists ESM-loaded tools from esm-multi package', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('multi:greet');
  });

  // ═══════════════════════════════════════════════════════════════
  // TOOL EXECUTION
  // ═══════════════════════════════════════════════════════════════

  test('calls ESM tool echo', async ({ mcp }) => {
    const result = await mcp.tools.call('esm:echo', { message: 'hello' });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent(JSON.stringify({ message: 'hello' }));
  });

  test('calls ESM tool add', async ({ mcp }) => {
    const result = await mcp.tools.call('esm:add', { a: 2, b: 3 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('5');
  });

  test('calls ESM tool greet from multi package', async ({ mcp }) => {
    const result = await mcp.tools.call('multi:greet', { name: 'Alice' });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('Hello, Alice!');
  });

  // ═══════════════════════════════════════════════════════════════
  // RESOURCE DISCOVERY
  // ═══════════════════════════════════════════════════════════════

  test('lists ESM-loaded resources', async ({ mcp }) => {
    const resources = await mcp.resources.list();
    log(
      '[TEST] Found resources:',
      resources.map((r: unknown) => {
        if (typeof r === 'object' && r !== null && 'name' in r) {
          return (r as { name: string }).name;
        }
        return String(r);
      }),
    );

    expect(resources).toContainResource('esm://status');
  });

  // ═══════════════════════════════════════════════════════════════
  // PROMPT DISCOVERY
  // ═══════════════════════════════════════════════════════════════

  test('lists ESM-loaded prompts', async ({ mcp }) => {
    const prompts = await mcp.prompts.list();
    log(
      '[TEST] Found prompts:',
      prompts.map((p: unknown) => {
        if (typeof p === 'object' && p !== null && 'name' in p) {
          return (p as { name: string }).name;
        }
        return String(p);
      }),
    );

    expect(prompts).toContainPrompt('multi:greeting-prompt');
  });

  // ═══════════════════════════════════════════════════════════════
  // MULTI-APP ISOLATION
  // ═══════════════════════════════════════════════════════════════

  test('ESM tools from different packages have separate namespaces', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const toolNames = tools.map((t: unknown) => {
      if (typeof t === 'object' && t !== null && 'name' in t) {
        return (t as { name: string }).name;
      }
      return String(t);
    });

    const esmTools = toolNames.filter((n: string) => n.startsWith('esm:'));
    const multiTools = toolNames.filter((n: string) => n.startsWith('multi:'));

    expect(esmTools.length).toBeGreaterThanOrEqual(2);
    expect(multiTools.length).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════

  test('should handle non-existent ESM tool gracefully', async ({ mcp }) => {
    const result = await mcp.tools.call('esm:non-existent-tool', {});
    expect(result.isError).toBe(true);
  });
});
