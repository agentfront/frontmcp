/**
 * @file perf-test.ts
 * @description Performance test fixture extending the standard test fixture
 *
 * Provides a Playwright-like fixture API for performance testing:
 *
 * @example
 * ```typescript
 * import { perfTest, expect } from '@frontmcp/testing';
 *
 * perfTest.describe('Cache Performance', () => {
 *   perfTest.use({
 *     server: 'apps/e2e/demo-e2e-cache/src/main.ts',
 *     project: 'demo-e2e-cache',
 *     publicMode: true,
 *   });
 *
 *   perfTest('cache operations memory overhead', async ({ mcp, perf }) => {
 *     await perf.baseline();
 *
 *     for (let i = 0; i < 100; i++) {
 *       await mcp.tools.call('expensive-operation', { operationId: `test-${i}` });
 *     }
 *
 *     perf.assertThresholds({ maxHeapDelta: 10 * 1024 * 1024 });
 *   });
 * });
 * ```
 */

import { McpTestClient } from '../client/mcp-test-client';
import { McpTestClientBuilder } from '../client/mcp-test-client.builder';
import { TestTokenFactory } from '../auth/token-factory';
import { TestServer } from '../server/test-server';
import type { TestConfig, TestFixtures, AuthFixture, ServerFixture, TestUser } from '../fixtures/fixture-types';
import type { PerfFixtures, PerfTestConfig } from './types';
import { createPerfFixtures, addGlobalMeasurement, PerfFixturesImpl } from './perf-fixtures';

// ═══════════════════════════════════════════════════════════════════
// EXTENDED FIXTURE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Extended fixtures including performance testing
 */
export interface PerfTestFixtures extends TestFixtures {
  /** Performance fixture */
  perf: PerfFixtures;
}

/**
 * Test function that receives extended fixtures
 */
export type PerfTestFn = (fixtures: PerfTestFixtures) => Promise<void> | void;

/**
 * Enhanced test function with perf fixture support
 */
export interface PerfTestWithFixtures {
  (name: string, fn: PerfTestFn): void;

  /** Configure fixtures for this test file/suite */
  use(config: TestConfig & PerfTestConfig): void;

  /** Create a describe block */
  describe: typeof describe;

  /** Run before all tests in the file */
  beforeAll: typeof beforeAll;

  /** Run before each test */
  beforeEach: typeof beforeEach;

  /** Run after each test */
  afterEach: typeof afterEach;

  /** Run after all tests in the file */
  afterAll: typeof afterAll;

  /** Skip a test */
  skip(name: string, fn: PerfTestFn): void;

  /** Run only this test */
  only(name: string, fn: PerfTestFn): void;

  /** Mark test as todo (not implemented) */
  todo(name: string): void;
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════

/** Current test configuration */
let currentConfig: TestConfig & PerfTestConfig = {};

/** Server instance (shared across tests in a file) */
let serverInstance: TestServer | null = null;

/** Token factory instance */
let tokenFactory: TestTokenFactory | null = null;

/** Track if server was started by us */
let serverStartedByUs = false;

// ═══════════════════════════════════════════════════════════════════
// FIXTURE SETUP/TEARDOWN
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize shared resources once per test file
 */
async function initializeSharedResources(): Promise<void> {
  if (!tokenFactory) {
    tokenFactory = new TestTokenFactory();
  }

  if (!serverInstance) {
    if (currentConfig.baseUrl) {
      serverInstance = TestServer.connect(currentConfig.baseUrl);
      serverStartedByUs = false;
    } else if (currentConfig.server) {
      const serverCommand = resolveServerCommand(currentConfig.server);
      const isDebug = process.env['DEBUG'] === '1' || process.env['DEBUG_SERVER'] === '1';

      if (isDebug) {
        console.log(`[PerfTest] Starting server: ${serverCommand}`);
      }

      try {
        serverInstance = await TestServer.start({
          project: currentConfig.project,
          port: currentConfig.port,
          command: serverCommand,
          env: currentConfig.env,
          startupTimeout: currentConfig.startupTimeout ?? 30000,
          debug: isDebug,
        });
        serverStartedByUs = true;

        if (isDebug) {
          console.log(`[PerfTest] Server started at ${serverInstance.info.baseUrl}`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to start test server.\n\n` +
            `Server entry: ${currentConfig.server}\n` +
            `Project: ${currentConfig.project ?? 'default'}\n` +
            `Command: ${serverCommand}\n\n` +
            `Error: ${errMsg}`,
        );
      }
    } else {
      throw new Error('perfTest.use() requires either "server" (entry file path) or "baseUrl" option');
    }
  }
}

/**
 * Create fixtures for a single test
 */
async function createTestFixtures(
  testName: string,
): Promise<{ fixtures: PerfTestFixtures; perfImpl: PerfFixturesImpl }> {
  await initializeSharedResources();

  if (!serverInstance) {
    throw new Error('Server instance not initialized');
  }
  if (!tokenFactory) {
    throw new Error('Token factory not initialized');
  }

  const clientInstance = await McpTestClient.create({
    baseUrl: serverInstance.info.baseUrl,
    transport: currentConfig.transport ?? 'streamable-http',
    publicMode: currentConfig.publicMode,
  }).buildAndConnect();

  const auth = createAuthFixture(tokenFactory);
  const server = createServerFixture(serverInstance);
  const perfImpl = createPerfFixtures(testName, currentConfig.project ?? 'unknown');

  // Auto-capture baseline if forceGcOnBaseline is enabled
  if (currentConfig.forceGcOnBaseline !== false) {
    await perfImpl.baseline();
  }

  return {
    fixtures: {
      mcp: clientInstance,
      auth,
      server,
      perf: perfImpl,
    },
    perfImpl,
  };
}

/**
 * Clean up fixtures after a single test
 */
async function cleanupTestFixtures(
  fixtures: PerfTestFixtures,
  perfImpl: PerfFixturesImpl,
  testFailed = false,
): Promise<void> {
  // Build and store measurement
  const measurement = perfImpl.buildMeasurement();
  addGlobalMeasurement(measurement);

  // Output server logs if test failed
  if (testFailed && serverInstance) {
    const logs = serverInstance.getLogs();
    if (logs.length > 0) {
      console.error('\n[PerfTest] === Server Logs (test failed) ===');
      const recentLogs = logs.slice(-50);
      if (logs.length > 50) {
        console.error(`[PerfTest] (showing last 50 of ${logs.length} log entries)`);
      }
      console.error(recentLogs.join('\n'));
      console.error('[PerfTest] === End Server Logs ===\n');
    }
  }

  // Disconnect client
  if (fixtures.mcp.isConnected()) {
    await fixtures.mcp.disconnect();
  }
}

/**
 * Clean up shared resources after all tests in a file
 */
async function cleanupSharedResources(): Promise<void> {
  if (serverInstance && serverStartedByUs) {
    await serverInstance.stop();
  }
  serverInstance = null;
  tokenFactory = null;
  serverStartedByUs = false;
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE FACTORIES
// ═══════════════════════════════════════════════════════════════════

function createAuthFixture(factory: TestTokenFactory): AuthFixture {
  const users: Record<string, TestUser> = {
    admin: {
      sub: 'admin-001',
      scopes: ['admin:*', 'read', 'write', 'delete'],
      email: 'admin@test.local',
      name: 'Test Admin',
    },
    user: {
      sub: 'user-001',
      scopes: ['read', 'write'],
      email: 'user@test.local',
      name: 'Test User',
    },
    readOnly: {
      sub: 'readonly-001',
      scopes: ['read'],
      email: 'readonly@test.local',
      name: 'Read Only User',
    },
  };

  return {
    createToken: (opts) =>
      factory.createTestToken({
        sub: opts.sub,
        scopes: opts.scopes,
        claims: {
          email: opts.email,
          name: opts.name,
          ...opts.claims,
        },
        exp: opts.expiresIn,
      }),
    createExpiredToken: (opts) => factory.createExpiredToken(opts),
    createInvalidToken: (opts) => factory.createTokenWithInvalidSignature(opts),
    users: {
      admin: users['admin'],
      user: users['user'],
      readOnly: users['readOnly'],
    },
    getJwks: () => factory.getPublicJwks(),
    getIssuer: () => factory.getIssuer(),
    getAudience: () => factory.getAudience(),
  };
}

function createServerFixture(server: TestServer): ServerFixture {
  return {
    info: server.info,
    createClient: async (opts) => {
      return McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: opts?.transport ?? 'streamable-http',
        auth: opts?.token ? { token: opts.token } : undefined,
        clientInfo: opts?.clientInfo,
        publicMode: currentConfig.publicMode,
      }).buildAndConnect();
    },
    createClientBuilder: () => {
      return new McpTestClientBuilder({
        baseUrl: server.info.baseUrl,
        publicMode: currentConfig.publicMode,
      });
    },
    restart: () => server.restart(),
    getLogs: () => server.getLogs(),
    clearLogs: () => server.clearLogs(),
  };
}

function resolveServerCommand(server: string): string {
  if (server.includes(' ')) {
    return server;
  }
  return `npx tsx ${server}`;
}

// ═══════════════════════════════════════════════════════════════════
// TEST FUNCTION WITH PERF FIXTURES
// ═══════════════════════════════════════════════════════════════════

function perfTestWithFixtures(name: string, fn: PerfTestFn): void {
  it(name, async () => {
    const { fixtures, perfImpl } = await createTestFixtures(name);
    let testFailed = false;
    try {
      await fn(fixtures);
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      await cleanupTestFixtures(fixtures, perfImpl, testFailed);
    }
  });
}

function use(config: TestConfig & PerfTestConfig): void {
  currentConfig = { ...currentConfig, ...config };

  afterAll(async () => {
    await cleanupSharedResources();
  });
}

function skip(name: string, fn: PerfTestFn): void {
  it.skip(name, async () => {
    const { fixtures, perfImpl } = await createTestFixtures(name);
    let testFailed = false;
    try {
      await fn(fixtures);
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      await cleanupTestFixtures(fixtures, perfImpl, testFailed);
    }
  });
}

function only(name: string, fn: PerfTestFn): void {
  it.only(name, async () => {
    const { fixtures, perfImpl } = await createTestFixtures(name);
    let testFailed = false;
    try {
      await fn(fixtures);
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      await cleanupTestFixtures(fixtures, perfImpl, testFailed);
    }
  });
}

function todo(name: string): void {
  it.todo(name);
}

// ═══════════════════════════════════════════════════════════════════
// ATTACH STATIC METHODS
// ═══════════════════════════════════════════════════════════════════

const perfTest = perfTestWithFixtures as PerfTestWithFixtures;

perfTest.use = use;
perfTest.describe = describe;
perfTest.beforeAll = beforeAll;
perfTest.beforeEach = beforeEach;
perfTest.afterEach = afterEach;
perfTest.afterAll = afterAll;
perfTest.skip = skip;
perfTest.only = only;
perfTest.todo = todo;

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export { perfTest };
