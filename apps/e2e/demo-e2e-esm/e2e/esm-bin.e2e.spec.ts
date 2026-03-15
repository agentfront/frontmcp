/**
 * E2E Tests for ESM Package Loading in CLI/Bin Mode
 *
 * Tests the ESM loading pipeline through createForCli() — the same path used
 * by the FrontMCP CLI binary. Verifies:
 * - Tools are discoverable and callable in CLI mode (no HTTP server)
 * - Cache directory follows the expected environment-aware default
 *
 * Set DEBUG_E2E=1 for verbose logging.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, rm, fileExists } from '@frontmcp/utils';
import { TestServer } from '@frontmcp/testing';

const DEBUG = process.env['DEBUG_E2E'] === '1';
const log = DEBUG ? console.log.bind(console) : () => {};

// ESM package server instance
let esmServer: TestServer | null = null;
const ESM_SERVER_PORT = 50420;

// Temp cache dir to simulate homedir-style cache (avoid polluting actual homedir)
let testCacheDir: string;

beforeAll(async () => {
  // Create a temp dir for cache testing
  testCacheDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-esm-cli-test-'));

  log(`[E2E] Starting ESM package server on port ${ESM_SERVER_PORT}...`);
  try {
    esmServer = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts',
      project: 'esm-package-server-cli',
      port: ESM_SERVER_PORT,
      startupTimeout: 30000,
      healthCheckPath: '/@test/esm-tools',
      debug: DEBUG,
      env: { ESM_SERVER_PORT: String(ESM_SERVER_PORT) },
    });
    log('[E2E] ESM package server started:', esmServer.info.baseUrl);
  } catch (error) {
    console.error('[E2E] Failed to start ESM package server:', error);
    throw error;
  }
}, 60000);

afterAll(async () => {
  if (esmServer) {
    log('[E2E] Stopping ESM package server...');
    await esmServer.stop();
    esmServer = null;
  }
  // Clean up temp cache dir
  try {
    await rm(testCacheDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}, 30000);

describe('ESM CLI/Bin Mode E2E', () => {
  let client: Awaited<ReturnType<(typeof import('@frontmcp/sdk'))['connect']>>;

  beforeAll(async () => {
    const { connect, loadFrom, LogLevel } = await import('@frontmcp/sdk');

    if (!esmServer) throw new Error('ESM package server was not started');
    const esmServerUrl = `http://127.0.0.1:${esmServer.info.port}`;

    client = await connect(
      {
        info: { name: 'ESM CLI Test', version: '0.1.0' },
        loader: { url: esmServerUrl },
        apps: [
          loadFrom('@test/esm-tools@^1.0.0', {
            namespace: 'esm',
            cacheTTL: 60000,
          }),
        ],
        logging: { level: LogLevel.Warn },
      },
      { mode: 'cli' },
    );
    log('[E2E] CLI-mode client connected');
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // TOOL DISCOVERY IN CLI MODE
  // ═══════════════════════════════════════════════════════════════

  it('lists ESM-loaded tools in CLI mode', async () => {
    const tools = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    log('[TEST] CLI tools:', toolNames);

    expect(toolNames).toContain('esm:echo');
    expect(toolNames).toContain('esm:add');
  });

  // ═══════════════════════════════════════════════════════════════
  // TOOL EXECUTION IN CLI MODE
  // ═══════════════════════════════════════════════════════════════

  it('calls ESM tool echo in CLI mode', async () => {
    const result = await client.callTool('esm:echo', { message: 'cli-test' });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain('cli-test');
  });

  it('calls ESM tool add in CLI mode', async () => {
    const result = await client.callTool('esm:add', { a: 10, b: 20 });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toBe('30');
  });

  // ═══════════════════════════════════════════════════════════════
  // CACHE DIRECTORY VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  it('cache directory follows environment-aware logic', async () => {
    // When running in a project with node_modules, the default cache
    // goes to {cwd}/node_modules/.cache/frontmcp-esm/
    const projectCacheDir = path.join(process.cwd(), 'node_modules', '.cache', 'frontmcp-esm');

    // Since we're running inside the monorepo (has node_modules),
    // cache should be project-local
    const hasNodeModules = await fileExists(path.join(process.cwd(), 'node_modules'));
    if (hasNodeModules) {
      // Prior tests loaded ESM tools which should have populated the cache
      const cacheExists = await fileExists(projectCacheDir);
      log('[TEST] Project-local cache dir:', projectCacheDir, 'exists:', cacheExists);
      expect(cacheExists).toBe(true);
    } else {
      // If no node_modules (unlikely in this test), homedir should be used
      const homedirCache = path.join(os.homedir(), '.frontmcp', 'esm-cache');
      const homedirCacheExists = await fileExists(homedirCache);
      log('[TEST] Homedir cache dir:', homedirCache, 'exists:', homedirCacheExists);
      expect(homedirCacheExists).toBe(true);
    }
  });

  it('second client with different namespace loads independently', async () => {
    const { connect, loadFrom, LogLevel } = await import('@frontmcp/sdk');
    if (!esmServer) throw new Error('ESM package server was not started');
    const esmServerUrl = `http://127.0.0.1:${esmServer.info.port}`;

    const customClient = await connect(
      {
        info: { name: 'ESM CLI Custom Cache', version: '0.1.0' },
        loader: { url: esmServerUrl },
        apps: [
          loadFrom('@test/esm-tools@^1.0.0', {
            namespace: 'custom',
            cacheTTL: 60000,
          }),
        ],
        logging: { level: LogLevel.Warn },
      },
      { mode: 'cli' },
    );

    // Tools should still work regardless of cache location
    try {
      const tools = await customClient.listTools();
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('custom:echo');
    } finally {
      await customClient.close();
    }
  });
});
