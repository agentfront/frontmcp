/**
 * @file fixture-types.ts
 * @description Type definitions for test fixtures
 */

import type { JWK } from 'jose';

import type { McpTestClient } from '../client/mcp-test-client';
import type { McpTestClientBuilder } from '../client/mcp-test-client.builder';

// ═══════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration passed to test.use()
 */
export interface TestConfig {
  /** Server entry file path (e.g., './src/main.ts') */
  server?: string;
  /**
   * E2E project name for port range allocation.
   * Each project has a dedicated port range to prevent conflicts during parallel test execution.
   * See E2E_PORT_RANGES in port-registry.ts for available ranges.
   *
   * @example 'demo-e2e-skills' - Uses ports 50200-50209
   * @example 'demo-e2e-public' - Uses ports 50000-50009
   */
  project?: string;
  /** Port to run server on (default, or `0`: auto-select a free port from the project range) */
  port?: number;
  /** Transport type (default: 'streamable-http') */
  transport?: 'sse' | 'streamable-http';
  /**
   * Describes the auth mode of the server under test. The server entry file decides its own auth, so
   * this does not reconfigure it; the fixture uses it to (1) keep the `mcp` client anonymous when
   * `mode` is `'public'` (unless `publicMode` says otherwise) and (2) pass it to the server process as
   * `FRONTMCP_TEST_AUTH_MODE` / `FRONTMCP_TEST_AUTH_TYPE`, which the entry file can read.
   */
  auth?: {
    mode?: 'public' | 'orchestrated' | 'local' | 'remote' | 'transparent';
    type?: 'local' | 'remote';
  };
  /**
   * Enable public mode for the test client.
   * When true, no Authorization header is sent and anonymous token is not requested.
   * Use this for testing servers configured with `auth: { mode: 'public' }`.
   */
  publicMode?: boolean;
  /** Server log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Startup timeout in ms (default: 30000) */
  startupTimeout?: number;
  /**
   * Base URL for connecting to an external/already running server.
   *
   * May also be supplied alongside `server`, in which case the booted server's
   * own URL is overridden — useful when the server is reachable through a proxy
   * or a different host than it binds (issue #543).
   */
  baseUrl?: string;
  /**
   * The server's `http.entryPath` — where MCP is mounted (`'/mcp'`, …).
   * Defaults to the server root.
   *
   * Issue #543: setting `http.entryPath` on the server used to take the whole
   * suite down, because the fixture always pointed its client at the root and
   * every spec failed with an opaque `HTTP 404` from inside the test client.
   * The client also recovers on its own when the server reports its paths in a
   * 404 body, so this is only needed when that report is unavailable.
   */
  entryPath?: string;
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Fixtures available in test functions
 */
export interface TestFixtures {
  /** Auto-connected MCP client */
  mcp: McpTestClient;
  /** Token factory for auth testing */
  auth: AuthFixture;
  /** Server control */
  server: ServerFixture;
}

/**
 * Auth fixture for creating and managing test tokens
 */
export interface AuthFixture {
  /**
   * Create a JWT token with the specified claims
   */
  createToken(options: {
    sub: string;
    scopes?: string[];
    email?: string;
    name?: string;
    claims?: Record<string, unknown>;
    expiresIn?: number;
  }): Promise<string>;

  /**
   * Create an expired token (for testing token expiration)
   */
  createExpiredToken(options: { sub: string }): Promise<string>;

  /**
   * Create a token with an invalid signature (for testing signature validation)
   */
  createInvalidToken(options: { sub: string }): string;

  /**
   * Pre-built test users with common permission sets
   */
  users: {
    admin: TestUser;
    user: TestUser;
    readOnly: TestUser;
  };

  /**
   * Get the public JWKS for verifying tokens
   */
  getJwks(): Promise<{ keys: JWK[] }>;

  /**
   * Get the issuer URL
   */
  getIssuer(): string;

  /**
   * Get the audience
   */
  getAudience(): string;
}

/**
 * Pre-defined test user
 */
export interface TestUser {
  sub: string;
  scopes: string[];
  email?: string;
  name?: string;
}

/**
 * Server fixture for controlling the test server
 */
export interface ServerFixture {
  /**
   * Server information
   */
  info: {
    baseUrl: string;
    port: number;
    /** The server process (the one listening on `port`, when it can be found; else its shell) */
    pid?: number;
  };

  /**
   * Create an additional MCP client connected to this server
   */
  createClient(options?: {
    transport?: 'sse' | 'streamable-http';
    token?: string;
    clientInfo?: { name: string; version: string };
    /** Override the MCP entry path for this client (default: `test.use()`'s). */
    entryPath?: string;
  }): Promise<McpTestClient>;

  /**
   * Create a client builder for full customization.
   * Use this when you need to set platform-specific capabilities.
   *
   * @example
   * ```typescript
   * const client = await server
   *   .createClientBuilder()
   *   .withTransport('streamable-http')
   *   .withPlatform('ext-apps')  // Auto-sets clientInfo AND capabilities
   *   .buildAndConnect();
   * ```
   */
  createClientBuilder(): McpTestClientBuilder;

  /**
   * Restart the server
   */
  restart(): Promise<void>;

  /**
   * Get captured server logs
   */
  getLogs(): string[];

  /**
   * Clear captured server logs
   */
  clearLogs(): void;
}

// ═══════════════════════════════════════════════════════════════════
// TEST FUNCTION TYPE
// ═══════════════════════════════════════════════════════════════════

/**
 * Test function that receives fixtures
 */
export type TestFn = (fixtures: TestFixtures) => Promise<void> | void;

/**
 * `test.beforeEach` / `test.afterEach`: `fn` receives the test's fixtures when it declares a
 * parameter. Jest's `done` callback style is not supported here; use Jest's own hooks for that.
 */
export type FixtureEachHook = (fn: (fixtures: TestFixtures) => unknown, timeout?: number) => void;

/**
 * Enhanced test function with fixture support
 */
export interface TestWithFixtures {
  (name: string, fn: TestFn): void;

  /**
   * Configure fixtures. At file level it applies to the whole file; inside a `test.describe` it applies
   * to that block only (and blocks nested in it), inheriting the outer configuration.
   */
  use(config: TestConfig): void;

  /** Create a describe block */
  describe: typeof describe;

  /** Run before all tests in the file (a plain Jest hook: it receives no fixtures) */
  beforeAll: typeof beforeAll;

  /**
   * Run before each test. A callback that takes a parameter receives the test's fixtures
   * (`test.beforeEach(async ({ mcp }) => …)`) — the same `mcp`, `server` and `auth` the test gets —
   * and runs inside every `test(...)` of the enclosing block, outer blocks first. A callback without
   * parameters is a plain Jest `beforeEach` (`timeout` applies only to that form).
   */
  beforeEach: FixtureEachHook;

  /**
   * Run after each test, with the same fixtures as `beforeEach` (inner blocks first). Fixtures are
   * torn down after the last `afterEach`. A callback without parameters is a plain Jest `afterEach`.
   */
  afterEach: FixtureEachHook;

  /** Run after all tests in the file (a plain Jest hook: it receives no fixtures) */
  afterAll: typeof afterAll;

  /** Skip a named test. */
  skip(name: string, fn: TestFn): void;
  /**
   * Playwright-style conditional skip: when `condition` is true, every test
   * registered after this call in the enclosing `describe` (or file) is
   * skipped. Put it at the top of the block you want to gate.
   *
   * @example
   * test.describe('against the live API', () => {
   *   test.skip(!hasCredentials, 'credentials not set');
   *   test('lookup', async ({ mcp }) => { ... });
   * });
   */
  skip(condition: boolean, reason?: string): void;

  /** Run only this test */
  only(name: string, fn: TestFn): void;

  /** Mark test as todo (not implemented) */
  todo(name: string): void;

  /**
   * Parameterized test. Each row is passed after the fixtures; titles support Jest's
   * `%s` / `%d` / `$key` placeholders.
   *
   * @example
   * test.each([['add', 1, 2, 3], ['sub', 3, 1, 2]])('%s', async ({ mcp }, tool, a, b, expected) => { ... });
   */
  each<Row extends readonly unknown[]>(
    table: ReadonlyArray<Row>,
  ): (name: string, fn: (fixtures: TestFixtures, ...row: Row) => Promise<void> | void) => void;
  each<Value>(
    table: ReadonlyArray<Value>,
  ): (name: string, fn: (fixtures: TestFixtures, value: Value) => Promise<void> | void) => void;
}
