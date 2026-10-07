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

import { TestTokenFactory } from '../auth/token-factory';
import { McpTestClient } from '../client/mcp-test-client';
import { McpTestClientBuilder } from '../client/mcp-test-client.builder';
import { TestServer } from '../server/test-server';
import type {
  AuthFixture,
  ServerFixture,
  TestConfig,
  TestFixtures,
  TestFn,
  TestUser,
  TestWithFixtures,
} from './fixture-types';
import { gatewayTokenBinding } from './gateway-token-binding';

// ═══════════════════════════════════════════════════════════════════
// JEST BINDINGS
// ═══════════════════════════════════════════════════════════════════

/**
 * The Jest API, resolved on first use rather than at import time. `@jest/globals` throws when it
 * is required outside a Jest environment, which used to make the whole package (token factory,
 * mock OAuth server, ...) unimportable from plain Node scripts. Now only the fixture functions
 * that really need Jest do, and they say so.
 */
interface JestApi {
  describe: jest.Describe;
  beforeAll: jest.Lifecycle;
  beforeEach: jest.Lifecycle;
  afterEach: jest.Lifecycle;
  afterAll: jest.Lifecycle;
  it: jest.It;
}

let jestApi: JestApi | undefined;

function jestGlobals(): JestApi {
  if (jestApi) return jestApi;
  try {
    const api = require('@jest/globals') as Record<string, unknown>;
    // Cast: the types of @jest/globals differ slightly from the global declarations used here
    jestApi = {
      describe: api['describe'],
      beforeAll: api['beforeAll'],
      beforeEach: api['beforeEach'],
      afterEach: api['afterEach'],
      afterAll: api['afterAll'],
      it: api['it'],
    } as unknown as JestApi;
    return jestApi;
  } catch (error) {
    throw new Error(
      `@frontmcp/testing fixtures ("test", "test.use", ...) can only be used inside a Jest test file: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// SCOPES AND SHARED STATE
// ═══════════════════════════════════════════════════════════════════

/**
 * One scope per `test.describe` block (index 0 is the file itself).
 *
 * `test.use()` writes into the scope it is called in, so a describe block's configuration applies
 * to that block only and inherits from the enclosing ones — the same as Playwright. A test
 * captures its chain of scopes when it is registered and merges their configuration when it runs,
 * so `test.use()` may appear before or after the tests it configures.
 *
 * The scope also carries the conditional-skip state (issue #541: `test.skip(condition, reason)`
 * used to reach Jest's `skip(name, fn)` and throw "Invalid first argument, true" at collection
 * time, taking the whole suite down).
 */
interface Scope {
  skipped: boolean;
  reason?: string;
  /** `test.use()` configuration of this scope, without `env` (kept in `envs`) */
  config: TestConfig;
  /**
   * The `env` objects passed to `test.use()` here, in call order. Kept by reference and merged
   * when a server is started, so an object a `beforeAll` fills in later (a port only known once
   * another server is up) still reaches the server.
   */
  envs: Array<Record<string, string>>;
  /** true once `test.use()` was called here — the scope then owns (and stops) servers it starts */
  configured: boolean;
  cleanupRegistered: boolean;
  /** `test.beforeEach` / `test.afterEach` hooks that take fixtures, run inside each test of the scope */
  beforeEachHooks: FixtureHook[];
  afterEachHooks: FixtureHook[];
}

/** A `test.beforeEach` / `test.afterEach` callback that receives the test's fixtures */
type FixtureHook = (fixtures: TestFixtures) => unknown;

function newScope(parent?: Scope): Scope {
  return {
    skipped: parent?.skipped ?? false,
    reason: parent?.reason,
    config: {},
    envs: [],
    configured: false,
    cleanupRegistered: false,
    beforeEachHooks: [],
    afterEachHooks: [],
  };
}

const scopes: Scope[] = [newScope()];

function currentScope(): Scope {
  return scopes[scopes.length - 1];
}

/** A booted (or externally reachable) server plus everything derived from it */
interface ServerEntry {
  server: TestServer;
  startedByUs: boolean;
  tokenFactory: TestTokenFactory;
  /** The scope whose afterAll stops it */
  owner: Scope;
}

/** Servers of this test file, by the configuration that identifies them */
const serverEntries = new Map<string, Promise<ServerEntry>>();

/** Merge the configuration of a scope chain: later (inner) scopes win, `env` merges key by key */
function resolveConfig(chain: readonly Scope[]): TestConfig {
  const merged: TestConfig = {};
  for (const scope of chain) {
    Object.assign(merged, scope.config);
    for (const env of scope.envs) merged.env = { ...merged.env, ...env };
  }
  return merged;
}

/** Deepest scope that configured itself, or the file scope */
function ownerScopeOf(chain: readonly Scope[]): Scope {
  for (let i = chain.length - 1; i > 0; i--) {
    if (chain[i].configured) return chain[i];
  }
  return chain[0];
}

/** What identifies a server: anything that changes how it is started or reached */
function serverKey(config: TestConfig): string {
  const env = Object.fromEntries(Object.entries(config.env ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    server: config.server,
    baseUrl: config.baseUrl,
    project: config.project,
    port: config.port,
    entryPath: config.entryPath,
    startupTimeout: config.startupTimeout,
    logLevel: config.logLevel,
    auth: config.auth,
    env,
  });
}

/**
 * Environment the fixture hands to the server it boots: `test.use({ logLevel })` as the server's default log level,
 * and `test.use({ auth })` for its entry file to follow.
 */
function serverEnv(config: TestConfig): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (config.logLevel) extra['FRONTMCP_LOG_LEVEL'] = config.logLevel;
  if (config.auth?.mode) extra['FRONTMCP_TEST_AUTH_MODE'] = config.auth.mode;
  if (config.auth?.type) extra['FRONTMCP_TEST_AUTH_TYPE'] = config.auth.type;
  if (Object.keys(extra).length === 0 && !config.env) return undefined;
  return { ...extra, ...config.env };
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE SETUP/TEARDOWN
// ═══════════════════════════════════════════════════════════════════

async function startServerEntry(config: TestConfig, owner: Scope): Promise<ServerEntry> {
  let server: TestServer;
  let startedByUs = false;

  if (config.baseUrl && !config.server) {
    // Connect to an existing external server
    server = TestServer.connect(config.baseUrl);
  } else if (config.server) {
    const serverCommand = resolveServerCommand(config.server);
    const isDebug = config.logLevel === 'debug' || process.env['DEBUG'] === '1' || process.env['DEBUG_SERVER'] === '1';

    if (isDebug) {
      console.log(`[TestFixture] Starting server: ${serverCommand}`);
    }

    try {
      server = await TestServer.start({
        project: config.project,
        port: config.port,
        command: serverCommand,
        env: serverEnv(config),
        startupTimeout: config.startupTimeout ?? 30000,
        debug: isDebug,
      });
      startedByUs = true;

      if (isDebug) {
        console.log(`[TestFixture] Server started at ${server.info.baseUrl}`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to start test server.\n\n` +
          `Server entry: ${config.server}\n` +
          `Project: ${config.project ?? 'default'}\n` +
          `Command: ${serverCommand}\n\n` +
          `Error: ${errMsg}`,
        { cause: error },
      );
    }
  } else {
    throw new Error('test.use() requires either "server" (entry file path) or "baseUrl" (for external server) option');
  }

  // When the test config passes a JWT_SECRET to the server (gateway modes — auth.mode
  // public/local/remote verify tokens against their own HS256 secret), sign fixture tokens with that
  // SAME secret so `auth.createToken` mints genuinely-valid tokens, and mint them the way that
  // server does: its MCP URL (address + entry path) as issuer (`iss`) and as audience (`aud`),
  // since a gateway token is only accepted by the server it was issued by and for. Without a shared
  // secret the factory stays RS256 + JWKS for transparent mode.
  const sharedSecret = config.env?.['JWT_SECRET'];
  const binding = sharedSecret
    ? gatewayTokenBinding(config.baseUrl ?? server.info.baseUrl, config.entryPath)
    : undefined;
  const tokenFactory = new TestTokenFactory(sharedSecret ? { hmacSecret: sharedSecret, ...binding } : {});

  return { server, startedByUs, tokenFactory, owner };
}

/** Get the server for a chain of scopes, starting it on first use */
function acquireServer(chain: readonly Scope[]): Promise<ServerEntry> {
  const config = resolveConfig(chain);
  const key = serverKey(config);
  let entry = serverEntries.get(key);
  if (!entry) {
    entry = startServerEntry(config, ownerScopeOf(chain));
    serverEntries.set(key, entry);
    entry.catch(() => serverEntries.delete(key));
  }
  return entry;
}

/** Stop the servers owned by a scope (or, without one, every server of the file) */
async function stopServers(owner?: Scope): Promise<void> {
  for (const [key, pending] of Array.from(serverEntries)) {
    let entry: ServerEntry;
    try {
      entry = await pending;
    } catch {
      serverEntries.delete(key);
      continue;
    }
    if (owner && entry.owner !== owner) continue;
    serverEntries.delete(key);
    if (entry.startedByUs) {
      await entry.server.stop();
    }
  }
}

/** Per-test bookkeeping: clients handed out by `server.createClient` are closed with the test */
interface FixtureContext {
  extraClients: McpTestClient[];
}

const fixtureContexts = new WeakMap<TestFixtures, FixtureContext>();

async function buildFixtures(chain: readonly Scope[]): Promise<TestFixtures> {
  const config = resolveConfig(chain);
  const entry = await acquireServer(chain);
  const { server, tokenFactory } = entry;

  // `auth: { mode: 'public' }` describes the server, so the client stays anonymous unless told otherwise
  const publicMode = config.publicMode ?? config.auth?.mode === 'public';
  const clientConfig = { ...config, publicMode };

  // Create the MCP client for this test. It is connected eagerly so the `mcp`
  // fixture is ready to use, but the connect is TOLERANT of auth-required
  // servers: a server with non-public auth (e.g. `allowDefaultPublic:false`)
  // correctly rejects the anonymous bootstrap token and answers `initialize`
  // with 401. Suites that only exercise the OAuth/HTTP surface via the
  // `server`/`auth` fixtures (and never touch `mcp`) must still run. If a test
  // does use an unconnected `mcp` client the failure surfaces clearly at the
  // point of use rather than aborting the whole file in fixture setup.
  const clientInstance = McpTestClient.create({
    baseUrl: resolveClientBaseUrl(server, clientConfig),
    entryPath: clientConfig.entryPath,
    transport: clientConfig.transport ?? 'streamable-http',
    publicMode,
  }).build();

  try {
    await clientInstance.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b401\b|unauthor/i.test(message)) {
      console.warn(
        `[TestFixture] MCP client could not connect anonymously — the server requires ` +
          `authentication (${message}). Tests using only the 'server'/'auth' fixtures are ` +
          `unaffected; tests using the 'mcp' fixture must supply a token.`,
      );
    } else {
      throw err;
    }
  }

  const context: FixtureContext = { extraClients: [] };
  const fixtures: TestFixtures = {
    mcp: clientInstance,
    auth: createAuthFixture(tokenFactory),
    server: createServerFixture(server, clientConfig, clientInstance, context),
  };
  fixtureContexts.set(fixtures, context);
  return fixtures;
}

/**
 * Create fixtures for a single test, from the configuration in effect where it is called
 * (`test.use()` at file level unless called inside a `test.describe`).
 */
async function createTestFixtures(): Promise<TestFixtures> {
  return buildFixtures(scopes.slice());
}

/**
 * Initialize shared resources (start the server) for the configuration in effect where it is called
 */
async function initializeSharedResources(): Promise<void> {
  await acquireServer(scopes.slice());
}

/**
 * Clean up fixtures after a single test
 * @param fixtures - The test fixtures to clean up
 * @param testFailed - Whether the test failed (to output server logs)
 */
async function cleanupTestFixtures(fixtures: TestFixtures, testFailed = false): Promise<void> {
  // Output server logs if test failed (helps with debugging)
  if (testFailed) {
    const logs = fixtures.server.getLogs();
    if (logs.length > 0) {
      console.error('\n[TestFixture] === Server Logs (test failed) ===');
      // Show last 50 lines of logs to avoid flooding output
      const recentLogs = logs.slice(-50);
      if (logs.length > 50) {
        console.error(`[TestFixture] (showing last 50 of ${logs.length} log entries)`);
      }
      console.error(recentLogs.join('\n'));
      console.error('[TestFixture] === End Server Logs ===\n');
    }
  }

  const extras = fixtureContexts.get(fixtures)?.extraClients ?? [];
  for (const client of extras) {
    if (client.isConnected()) {
      await client.disconnect().catch(() => undefined);
    }
  }

  // Disconnect client
  if (fixtures.mcp.isConnected()) {
    await fixtures.mcp.disconnect();
  }
}

/**
 * Clean up shared resources: stops every server this test file started
 */
async function cleanupSharedResources(): Promise<void> {
  await stopServers();
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * The URL the test client should talk to.
 *
 * Issue #543: `test.use()` accepted `baseUrl` only as an *alternative* to
 * `server` — supplying both took the `server` branch and silently discarded the
 * explicit URL. An explicit `baseUrl` now overrides the booted server's own,
 * which is what you need when the server is reachable through a proxy or a
 * different host than it binds.
 */
function resolveClientBaseUrl(server: TestServer, config: TestConfig): string {
  return config.baseUrl ?? server.info.baseUrl;
}

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
function createServerFixture(
  server: TestServer,
  config: TestConfig,
  mcp: McpTestClient,
  context: FixtureContext,
): ServerFixture {
  return {
    // Live view: `pid` is filled in once the server is listening and follows restarts
    get info() {
      return server.info;
    },

    createClient: async (opts) => {
      // Inherit publicMode and the MCP entry path from the current config so
      // every client reaches the same endpoint the `mcp` fixture does (#543).
      // An explicit token is always sent — also in public mode, where the server
      // simply accepts it as well as anonymous access.
      const client = await McpTestClient.create({
        baseUrl: resolveClientBaseUrl(server, config),
        entryPath: opts?.entryPath ?? config.entryPath,
        transport: opts?.transport ?? 'streamable-http',
        auth: opts?.token ? { token: opts.token } : undefined,
        clientInfo: opts?.clientInfo,
        publicMode: config.publicMode,
      }).buildAndConnect();
      context.extraClients.push(client);
      return client;
    },

    createClientBuilder: () => {
      // Return a pre-configured builder with the server's base URL and publicMode
      // This allows full customization including platform-specific capabilities
      const builder = new McpTestClientBuilder({
        baseUrl: resolveClientBaseUrl(server, config),
        entryPath: config.entryPath,
        publicMode: config.publicMode,
      });
      return builder;
    },

    restart: async () => {
      const reconnect = [mcp, ...context.extraClients].filter((client) => client.isConnected());
      await server.restart();
      // A restarted server has forgotten every session: open new ones (keeping each client's token)
      for (const client of reconnect) {
        await client.reconnect();
      }
    },

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
 * Enhanced test function that provides fixtures. `extra` carries the row of a `test.each` table.
 */
function runWithFixtures(
  fn: (fixtures: TestFixtures, ...extra: never[]) => Promise<void> | void,
  chain: readonly Scope[],
) {
  return async (...extra: unknown[]): Promise<void> => {
    const fixtures = await buildFixtures(chain);
    // The first error wins: a failing test is reported as such even when an afterEach hook fails too.
    let failure: { error: unknown } | undefined;
    try {
      // Playwright order: outer `beforeEach` hooks first, the test, then inner `afterEach` hooks
      // first. Every hook sees the same fixtures as the test; they are torn down after the last one.
      for (const scope of chain) {
        for (const hook of scope.beforeEachHooks) await hook(fixtures);
      }
      await (fn as (fixtures: TestFixtures, ...rest: unknown[]) => Promise<void> | void)(fixtures, ...extra);
    } catch (error) {
      failure = { error };
    }
    try {
      await runAfterEachHooks(chain, fixtures);
    } catch (error) {
      failure ??= { error };
    }
    await cleanupTestFixtures(fixtures, failure !== undefined);
    if (failure) throw failure.error;
  };
}

/** Run every `afterEach` fixture hook, even after a failure; rethrow the first error. */
async function runAfterEachHooks(chain: readonly Scope[], fixtures: TestFixtures): Promise<void> {
  let firstError: unknown;
  let failed = false;
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const hook of chain[i].afterEachHooks) {
      try {
        await hook(fixtures);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
  }
  if (failed) throw firstError;
}

function skipTitle(name: string, scope: Scope): string {
  return scope.reason ? `${name} (skipped: ${scope.reason})` : name;
}

function testWithFixtures(name: string, fn: TestFn): void {
  const chain = scopes.slice();
  // A `test.skip(condition, reason)` earlier in this block (or an enclosing
  // one) turns every later registration into a skip.
  const scope = currentScope();
  if (scope.skipped) {
    jestGlobals().it.skip(skipTitle(name, scope), runWithFixtures(fn, chain));
    return;
  }
  jestGlobals().it(name, runWithFixtures(fn, chain));
}

/**
 * Configure test fixtures for the current test file, or — inside a `test.describe` — for that block only.
 */
function use(config: TestConfig): void {
  const scope = currentScope();
  const { env, ...rest } = config;
  scope.config = { ...scope.config, ...rest };
  if (env) scope.envs.push(env);
  scope.configured = true;

  // The scope that configured the servers stops them once its tests are done
  if (!scope.cleanupRegistered) {
    scope.cleanupRegistered = true;
    jestGlobals().afterAll(async () => {
      await stopServers(scope === scopes[0] ? undefined : scope);
    });
  }
}

/**
 * Skip a test, or — Playwright-style — every test registered after this call
 * in the enclosing block when `condition` is true.
 *
 * @example
 * test.skip('not ready yet', async ({ mcp }) => { ... });
 *
 * @example
 * test.describe('against the live API', () => {
 *   test.skip(!hasCredentials, 'credentials not set');
 *   test('lookup', async ({ mcp }) => { ... });
 * });
 */
function skip(nameOrCondition: string | boolean, fnOrReason?: TestFn | string): void {
  if (typeof nameOrCondition === 'boolean') {
    if (nameOrCondition) {
      const scope = currentScope();
      scope.skipped = true;
      scope.reason = typeof fnOrReason === 'string' ? fnOrReason : undefined;
    }
    return;
  }

  if (typeof fnOrReason !== 'function') {
    throw new TypeError(
      `test.skip expects either (name: string, fn) or (condition: boolean, reason?: string); ` +
        `received (${typeof nameOrCondition}, ${typeof fnOrReason}).`,
    );
  }

  jestGlobals().it.skip(nameOrCondition, runWithFixtures(fnOrReason, scopes.slice()));
}

/**
 * Run only this test.
 *
 * A focused test still honours an enclosing conditional skip — otherwise
 * `test.only` inside a credential-gated block would run without the credentials
 * the block was gated on.
 */
function only(name: string, fn: TestFn): void {
  const scope = currentScope();
  if (scope.skipped) {
    jestGlobals().it.skip(skipTitle(name, scope), runWithFixtures(fn, scopes.slice()));
    return;
  }
  jestGlobals().it.only(name, runWithFixtures(fn, scopes.slice()));
}

/**
 * Mark test as todo
 */
function todo(name: string): void {
  jestGlobals().it.todo(name);
}

/**
 * `test.each(table)(name, (fixtures, ...row) => …)` — a parameterized test. Rows are passed after
 * the fixtures; titles use the same `%s` / `$key` placeholders as Jest's `it.each`.
 */
function each(table: unknown, ...tagged: unknown[]) {
  const chain = scopes.slice();
  const register = (
    jestGlobals().it.each as (...args: unknown[]) => (name: string, fn: (...row: unknown[]) => unknown) => void
  )(table, ...tagged);
  return (name: string, fn: (fixtures: TestFixtures, ...row: never[]) => Promise<void> | void): void => {
    const scope = currentScope();
    if (scope.skipped) {
      const skipRegister = (
        jestGlobals().it.skip.each as (...args: unknown[]) => (name: string, fn: (...row: unknown[]) => unknown) => void
      )(table, ...tagged);
      skipRegister(skipTitle(name, scope), runWithFixtures(fn, chain));
      return;
    }
    register(name, runWithFixtures(fn, chain));
  };
}

/**
 * `describe` that gives its body its own scope: its own conditional-skip state and its own
 * `test.use()` configuration.
 *
 * Jest runs a describe callback synchronously during collection, so pushing a
 * scope around it is enough to bound both to that block. A nested block inherits the outer
 * decision — an outer skip is never undone by an inner one — and the outer configuration.
 * `.only`, `.skip` and `.each` are provided so the surface is unchanged.
 */
function withScope<Args extends unknown[]>(fn: (...args: Args) => unknown): (...args: Args) => void {
  return (...args: Args): void => {
    scopes.push(newScope(currentScope()));
    try {
      fn(...args);
    } finally {
      scopes.pop();
    }
  };
}

type DescribeRegister = (name: string, body: (...args: never[]) => unknown, timeout?: number) => void;

function scopedRegister(pick: () => DescribeRegister) {
  return (name: string, fn: (...args: never[]) => unknown, timeout?: number): void => {
    pick()(name, withScope(fn as (...args: unknown[]) => unknown) as (...args: never[]) => unknown, timeout);
  };
}

/**
 * `describe.each(table)(name, fn)` — the registrar needs the same scoping, and the row values must
 * still reach the body.
 */
function scopedEach(pick: () => unknown) {
  return (...eachArgs: unknown[]) =>
    (name: string, fn: (...args: never[]) => unknown, timeout?: number): void => {
      const register = (pick() as (...args: unknown[]) => DescribeRegister)(...eachArgs);
      register(name, withScope(fn as (...args: unknown[]) => unknown) as (...args: never[]) => unknown, timeout);
    };
}

const describeWithScope = Object.assign(
  scopedRegister(() => jestGlobals().describe as unknown as DescribeRegister),
  {
    // `describe.skip` still evaluates its callback during collection, so it needs a scope too
    only: Object.assign(
      scopedRegister(() => jestGlobals().describe.only as unknown as DescribeRegister),
      {
        each: scopedEach(() => jestGlobals().describe.only.each),
      },
    ),
    skip: Object.assign(
      scopedRegister(() => jestGlobals().describe.skip as unknown as DescribeRegister),
      {
        each: scopedEach(() => jestGlobals().describe.skip.each),
      },
    ),
    each: scopedEach(() => jestGlobals().describe.each),
  },
) as unknown as jest.Describe;

/**
 * `test.beforeEach` / `test.afterEach`.
 *
 * A callback that declares a parameter receives the test's fixtures, Playwright-style
 * (`test.beforeEach(async ({ mcp }) => …)`): it runs inside every test of the enclosing block that
 * is registered with `test(...)`, with the same `mcp` / `server` / `auth` the test gets. Handing such
 * a callback to Jest would make Jest treat the parameter as a `done` callback and wait for it until
 * the test times out. A callback without parameters is a plain Jest hook, as before.
 */
function eachHook(kind: 'beforeEach' | 'afterEach') {
  return (fn: FixtureHook | (() => unknown), timeout?: number): void => {
    if (typeof fn === 'function' && fn.length > 0) {
      const scope = currentScope();
      (kind === 'beforeEach' ? scope.beforeEachHooks : scope.afterEachHooks).push(fn as FixtureHook);
      return;
    }
    jestGlobals()[kind](fn as () => unknown, timeout);
  };
}

// ═══════════════════════════════════════════════════════════════════
// ATTACH STATIC METHODS
// ═══════════════════════════════════════════════════════════════════

// Cast to the full interface type
const test = testWithFixtures as TestWithFixtures;

// Attach configuration method
test.use = use;

// Attach Jest lifecycle methods (resolved when called, see jestGlobals)
test.describe = describeWithScope;
test.beforeAll = ((...args: Parameters<jest.Lifecycle>) => jestGlobals().beforeAll(...args)) as jest.Lifecycle;
test.beforeEach = eachHook('beforeEach') as TestWithFixtures['beforeEach'];
test.afterEach = eachHook('afterEach') as TestWithFixtures['afterEach'];
test.afterAll = ((...args: Parameters<jest.Lifecycle>) => jestGlobals().afterAll(...args)) as jest.Lifecycle;

// Attach test modifiers
test.skip = skip;
test.only = only;
test.todo = todo;
test.each = each as TestWithFixtures['each'];

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export { test };

// Also export for advanced use cases
export { createTestFixtures, cleanupTestFixtures, initializeSharedResources, cleanupSharedResources };
