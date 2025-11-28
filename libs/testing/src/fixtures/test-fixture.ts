/**
 * @file test-fixture.ts
 * @description Jest-based fixture system for MCP testing
 *
 * Provides a Playwright-like fixture API for testing FrontMCP servers:
 *
 * @example
 * ```typescript
 * import { test, expect } from '@frontmcp/testing';
 *
 * test.use({
 *   server: './src/main.ts',
 *   port: 3003,
 * });
 *
 * test('server exposes tools', async ({ mcp }) => {
 *   const tools = await mcp.tools.list();
 *   expect(tools).toContainTool('my-tool');
 * });
 * ```
 */

import { McpTestClient } from '../client/mcp-test-client';
import { TestTokenFactory } from '../auth/token-factory';
import { TestServer } from '../server/test-server';
import type {
  TestConfig,
  TestFixtures,
  AuthFixture,
  ServerFixture,
  TestFn,
  TestWithFixtures,
  TestUser,
} from './fixture-types';

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════

/** Current test configuration (set via test.use()) */
let currentConfig: TestConfig = {};

/** Server instance (shared across tests in a file) */
let serverInstance: TestServer | null = null;

/** Token factory instance (shared across tests in a file) */
let tokenFactory: TestTokenFactory | null = null;

/** Track if server was started by us (vs external) */
let serverStartedByUs = false;

// ═══════════════════════════════════════════════════════════════════
// FIXTURE SETUP/TEARDOWN
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize shared resources (server, token factory) once per test file
 */
async function initializeSharedResources(): Promise<void> {
  // Create token factory if not exists
  if (!tokenFactory) {
    tokenFactory = new TestTokenFactory();
  }

  // Start or connect to server if not exists
  if (!serverInstance) {
    if (currentConfig.baseUrl) {
      // Connect to existing external server
      serverInstance = TestServer.connect(currentConfig.baseUrl);
      serverStartedByUs = false;
    } else if (currentConfig.server) {
      // Start new server
      serverInstance = await TestServer.start({
        port: currentConfig.port,
        command: resolveServerCommand(currentConfig.server),
        env: currentConfig.env,
        startupTimeout: currentConfig.startupTimeout ?? 30000,
        debug: currentConfig.logLevel === 'debug',
      });
      serverStartedByUs = true;
    } else {
      throw new Error(
        'test.use() requires either "server" (entry file path) or "baseUrl" (for external server) option',
      );
    }
  }
}

/**
 * Create fixtures for a single test
 */
async function createTestFixtures(): Promise<TestFixtures> {
  // Ensure shared resources are initialized
  await initializeSharedResources();

  // Create MCP client for this test
  // Pass publicMode if configured to skip authentication
  const clientInstance = await McpTestClient.create({
    baseUrl: serverInstance!.info.baseUrl,
    transport: currentConfig.transport ?? 'streamable-http',
    publicMode: currentConfig.publicMode,
  }).buildAndConnect();

  // Build fixtures
  const auth = createAuthFixture(tokenFactory!);
  const server = createServerFixture(serverInstance!);

  return {
    mcp: clientInstance,
    auth,
    server,
  };
}

/**
 * Clean up fixtures after a single test
 */
async function cleanupTestFixtures(fixtures: TestFixtures): Promise<void> {
  // Disconnect client
  if (fixtures.mcp.isConnected()) {
    await fixtures.mcp.disconnect();
  }
}

/**
 * Clean up shared resources after all tests in a file
 */
async function cleanupSharedResources(): Promise<void> {
  // Only stop server if we started it
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

/**
 * Create the auth fixture from token factory
 */
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

/**
 * Create the server fixture from test server
 */
function createServerFixture(server: TestServer): ServerFixture {
  return {
    info: server.info,

    createClient: async (opts) => {
      return McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: opts?.transport ?? 'streamable-http',
        auth: opts?.token ? { token: opts.token } : undefined,
      }).buildAndConnect();
    },

    restart: () => server.restart(),

    getLogs: () => server.getLogs(),

    clearLogs: () => server.clearLogs(),
  };
}

/**
 * Resolve server entry to a command
 */
function resolveServerCommand(server: string): string {
  // If it's already a command (contains spaces), use as-is
  if (server.includes(' ')) {
    return server;
  }
  // Otherwise, run with tsx
  return `npx tsx ${server}`;
}

// ═══════════════════════════════════════════════════════════════════
// TEST FUNCTION WITH FIXTURES
// ═══════════════════════════════════════════════════════════════════

/**
 * Enhanced test function that provides fixtures
 */
function testWithFixtures(name: string, fn: TestFn): void {
  it(name, async () => {
    const fixtures = await createTestFixtures();
    try {
      await fn(fixtures);
    } finally {
      await cleanupTestFixtures(fixtures);
    }
  });
}

/**
 * Configure test fixtures for the current test file/suite
 */
function use(config: TestConfig): void {
  // Merge with existing config
  currentConfig = { ...currentConfig, ...config };

  // Register cleanup hook if not already done
  // This ensures server is stopped after all tests in the file
  afterAll(async () => {
    await cleanupSharedResources();
  });
}

/**
 * Skip a test
 */
function skip(name: string, fn: TestFn): void {
  it.skip(name, async () => {
    const fixtures = await createTestFixtures();
    try {
      await fn(fixtures);
    } finally {
      await cleanupTestFixtures(fixtures);
    }
  });
}

/**
 * Run only this test
 */
function only(name: string, fn: TestFn): void {
  it.only(name, async () => {
    const fixtures = await createTestFixtures();
    try {
      await fn(fixtures);
    } finally {
      await cleanupTestFixtures(fixtures);
    }
  });
}

/**
 * Mark test as todo
 */
function todo(name: string): void {
  it.todo(name);
}

// ═══════════════════════════════════════════════════════════════════
// ATTACH STATIC METHODS
// ═══════════════════════════════════════════════════════════════════

// Cast to the full interface type
const test = testWithFixtures as TestWithFixtures;

// Attach configuration method
test.use = use;

// Attach Jest lifecycle methods
test.describe = describe;
test.beforeAll = beforeAll;
test.beforeEach = beforeEach;
test.afterEach = afterEach;
test.afterAll = afterAll;

// Attach test modifiers
test.skip = skip;
test.only = only;
test.todo = todo;

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export { test };

// Also export for advanced use cases
export { createTestFixtures, cleanupTestFixtures, initializeSharedResources, cleanupSharedResources };
