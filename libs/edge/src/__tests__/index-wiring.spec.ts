/**
 * White-box unit tests for `createEdgeMcp`'s WIRING — the managed-mode plugin
 * load, the refresh controller, cache resolution, the env→process.env bridge,
 * skill-index warm-up, the Cron `scheduled` entrypoint, and the Durable Object
 * factory hand-off.
 *
 * Unlike `index.spec.ts` (which boots a real scope and serves MCP end-to-end),
 * this spec mocks every external seam — `@frontmcp/sdk`, the lazily imported
 * `@frontmcp/plugin-skilled-openapi`, and `./session-host` — so each branch of
 * the factory is driven deterministically without standing up a server.
 */
import 'reflect-metadata';

// ---- mocks -----------------------------------------------------------------

const createForGraph = jest.fn();
const createWebFetchHandler = jest.fn();

jest.mock('@frontmcp/sdk', () => ({
  FrontMcpInstance: { createForGraph: (...args: unknown[]) => createForGraph(...args) },
  createWebFetchHandler: (...args: unknown[]) => createWebFetchHandler(...args),
}));

// Lazily-imported optional peer. We capture init() args + return a fake plugin.
const pluginInit = jest.fn(() => ({ __plugin: true }));
jest.mock(
  '@frontmcp/plugin-skilled-openapi',
  () => ({ __esModule: true, default: { init: (opts: unknown) => pluginInit(opts) } }),
  { virtual: true },
);

// Session host seam — assert the factory delegates, without the DO internals.
const createEdgeSessionRouter = jest.fn(() => 'ROUTER');
const createEdgeSessionDurableObject = jest.fn(() => class FakeDO {});
jest.mock('../session-host', () => ({
  createEdgeSessionRouter: (...args: unknown[]) => createEdgeSessionRouter(...args),
  createEdgeSessionDurableObject: (...args: unknown[]) => createEdgeSessionDurableObject(...args),
}));

import {
  buildManagedOpenApiPluginOptions,
  createEdgeMcp,
  createKvBundleCache,
  createKvSkillIndexCache,
  type EdgeMcpConfig,
  kvBundleCacheFromEnv,
  kvSkillIndexCacheFromEnv,
} from '../index';

// ---- helpers ---------------------------------------------------------------

interface FakeSkills {
  setIndexCache: jest.Mock;
  warmIndex: jest.Mock;
}

function makeScope(skills?: Partial<FakeSkills>): { skills?: FakeSkills } {
  if (!skills) return {};
  return {
    skills: {
      setIndexCache: skills.setIndexCache ?? jest.fn(),
      warmIndex: skills.warmIndex ?? jest.fn(async () => undefined),
    },
  };
}

function mockScopeBuild(scope: unknown): void {
  createForGraph.mockResolvedValue({ getScopes: () => [scope] });
}

const BASE: EdgeMcpConfig = {
  info: { name: 'edge', version: '1.0.0' },
  apps: [],
  tasks: { enabled: false },
} as unknown as EdgeMcpConfig;

const MANAGED = {
  endpoint: 'https://cloud.example.dev/v1/bundles/acme',
  authToken: 'tok',
  expectedAudience: 'acme:prod',
  jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
  expectedIssuer: 'https://cloud.example.dev',
};

beforeEach(() => {
  createForGraph.mockReset();
  createWebFetchHandler.mockReset();
  pluginInit.mockClear();
  createEdgeSessionRouter.mockClear();
  createEdgeSessionDurableObject.mockClear();
  createWebFetchHandler.mockReturnValue(jest.fn(async () => new Response('handler-ok', { status: 200 })));
  // Scrub any keys the bridge test sets so the once-only bridge can re-run.
  delete (process.env as Record<string, string>)['EDGE_TEST_VAR'];
  delete (process.env as Record<string, string>)['EDGE_TEST_PREEXISTING'];
});

// ---- construction ----------------------------------------------------------

describe('createEdgeMcp — construction', () => {
  it('returns a module with fetch + a Durable Object class, no scheduled in plain mode', () => {
    mockScopeBuild(makeScope());
    const edge = createEdgeMcp(BASE);
    expect(typeof edge.fetch).toBe('function');
    expect(typeof edge.SessionDurableObject).toBe('function');
    expect(edge.scheduled).toBeUndefined();
    // The DO factory is wired with buildScope + the env bridge.
    expect(createEdgeSessionDurableObject).toHaveBeenCalledTimes(1);
    const [buildScopeArg, bridgeArg] = createEdgeSessionDurableObject.mock.calls[0];
    expect(typeof buildScopeArg).toBe('function');
    expect(typeof bridgeArg).toBe('function');
  });

  it('only builds the session router when sessions are configured', () => {
    mockScopeBuild(makeScope());
    createEdgeMcp(BASE);
    expect(createEdgeSessionRouter).not.toHaveBeenCalled();

    createEdgeMcp({ ...BASE, sessions: {} } as EdgeMcpConfig);
    expect(createEdgeSessionRouter).toHaveBeenCalledWith('FRONTMCP_SESSIONS');

    createEdgeMcp({ ...BASE, sessions: { binding: 'MY_SESSIONS' } } as EdgeMcpConfig);
    expect(createEdgeSessionRouter).toHaveBeenLastCalledWith('MY_SESSIONS');
  });
});

// ---- lazy build + memoization ---------------------------------------------

describe('createEdgeMcp — lazy build & memoization', () => {
  it('builds the scope on first fetch (serve:false) and passes the sessionRouter only when set', async () => {
    const scope = makeScope();
    mockScopeBuild(scope);

    const plain = createEdgeMcp(BASE);
    await plain.fetch(new Request('https://w/'), { K: 1 });
    expect(createForGraph).toHaveBeenCalledTimes(1);
    expect(createForGraph.mock.calls[0][0]).toMatchObject({ serve: false });
    // No sessions → second arg is an empty options object.
    expect(createWebFetchHandler).toHaveBeenCalledWith(scope, {});

    createWebFetchHandler.mockClear();
    createForGraph.mockClear();
    mockScopeBuild(scope);
    const stateful = createEdgeMcp({ ...BASE, sessions: {} } as EdgeMcpConfig);
    await stateful.fetch(new Request('https://w/'));
    expect(createWebFetchHandler).toHaveBeenCalledWith(scope, { sessionRouter: 'ROUTER' });
  });

  it('memoizes the handler across requests (build runs once)', async () => {
    mockScopeBuild(makeScope());
    const edge = createEdgeMcp(BASE);
    await edge.fetch(new Request('https://w/'));
    await edge.fetch(new Request('https://w/'));
    expect(createForGraph).toHaveBeenCalledTimes(1);
  });

  it('clears the memo on a failed build so the next request retries', async () => {
    const boom = new Error('build failed');
    createForGraph.mockRejectedValueOnce(boom).mockResolvedValueOnce({ getScopes: () => [makeScope()] });
    const edge = createEdgeMcp(BASE);

    await expect(edge.fetch(new Request('https://w/'))).rejects.toBe(boom);
    expect(boom).toBeInstanceOf(Error);

    const res = await edge.fetch(new Request('https://w/'));
    expect(res.status).toBe(200);
    expect(createForGraph).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error when the config produces no scope', async () => {
    createForGraph.mockResolvedValue({ getScopes: () => [] });
    const edge = createEdgeMcp(BASE);
    await expect(edge.fetch(new Request('https://w/'))).rejects.toBeInstanceOf(Error);
    await expect(edge.fetch(new Request('https://w/'))).rejects.toThrow(/produced no scope/);
  });
});

// ---- env → process.env bridge ---------------------------------------------

describe('createEdgeMcp — env bridge', () => {
  // `bridgeEnvToProcessEnv` flips a module-scoped `envBridged` flag after the
  // first successful copy, so a fresh module registry is required to observe the
  // copy itself (other tests above have already tripped it on the shared module).
  async function freshCreateEdgeMcp(): Promise<typeof createEdgeMcp> {
    let factory: typeof createEdgeMcp = createEdgeMcp;
    await jest.isolateModulesAsync(async () => {
      const mod = await import('../index');
      factory = mod.createEdgeMcp;
    });
    return factory;
  }

  it('copies string env vars into process.env without clobbering pre-existing values', async () => {
    process.env['EDGE_TEST_PREEXISTING'] = 'original';
    mockScopeBuild(makeScope());
    const factory = await freshCreateEdgeMcp();
    const edge = factory(BASE);

    await edge.fetch(new Request('https://w/'), {
      EDGE_TEST_VAR: 'from-worker',
      EDGE_TEST_PREEXISTING: 'should-not-win',
      EDGE_TEST_NUMBER: 123, // non-string is skipped
    });

    expect(process.env['EDGE_TEST_VAR']).toBe('from-worker');
    expect(process.env['EDGE_TEST_PREEXISTING']).toBe('original');
    expect((process.env as Record<string, unknown>)['EDGE_TEST_NUMBER']).toBeUndefined();
  });

  it('is a no-op for a non-object env (does not throw)', async () => {
    mockScopeBuild(makeScope());
    const factory = await freshCreateEdgeMcp();
    const edge = factory(BASE);
    await expect(edge.fetch(new Request('https://w/'), undefined)).resolves.toBeDefined();
  });

  it('is a no-op when the host runtime exposes no process.env to bridge into', async () => {
    // A pure V8 isolate has no `process`; the bridge must early-return instead
    // of throwing. Temporarily strip `globalThis.process` for an isolated module.
    const original = (globalThis as { process?: unknown }).process;
    try {
      delete (globalThis as { process?: unknown }).process;
      mockScopeBuild(makeScope());
      const factory = await freshCreateEdgeMcp();
      const edge = factory(BASE);
      const res = await edge.fetch(new Request('https://w/'), { SOME_VAR: 'value' });
      expect(res.status).toBe(200);
    } finally {
      (globalThis as { process?: unknown }).process = original;
    }
  });

  it('early-returns when `process` exists but has no `env` object', async () => {
    // Exercises the `proc?.env` nullish branch where `process` is present but
    // `process.env` is undefined (some restricted runtimes).
    const original = (globalThis as { process?: unknown }).process;
    try {
      (globalThis as { process?: unknown }).process = {};
      mockScopeBuild(makeScope());
      const factory = await freshCreateEdgeMcp();
      const edge = factory(BASE);
      const res = await edge.fetch(new Request('https://w/'), { SOME_VAR: 'value' });
      expect(res.status).toBe(200);
    } finally {
      (globalThis as { process?: unknown }).process = original;
    }
  });

  it('skips non-string env values without touching the comparison side', async () => {
    // Drives the `typeof value === 'string'` short-circuit (left-false) so the
    // `&& proc.env[key] === undefined` right side is never evaluated.
    mockScopeBuild(makeScope());
    const factory = await freshCreateEdgeMcp();
    const edge = factory(BASE);
    const res = await edge.fetch(new Request('https://w/'), {
      EDGE_TEST_OBJECT: { nested: true },
      EDGE_TEST_BOOL: true,
    });
    expect(res.status).toBe(200);
    expect((process.env as Record<string, unknown>)['EDGE_TEST_OBJECT']).toBeUndefined();
    expect((process.env as Record<string, unknown>)['EDGE_TEST_BOOL']).toBeUndefined();
  });
});

// ---- skill-index cache wiring ---------------------------------------------

describe('createEdgeMcp — skill-index cache wiring', () => {
  it('skips wiring when skillIndex is not configured', async () => {
    const skills: FakeSkills = { setIndexCache: jest.fn(), warmIndex: jest.fn(async () => undefined) };
    mockScopeBuild(makeScope(skills));
    await createEdgeMcp(BASE).fetch(new Request('https://w/'));
    expect(skills.setIndexCache).not.toHaveBeenCalled();
  });

  it('attaches the cache + warms the index when a binding is present on env', async () => {
    const skills: FakeSkills = { setIndexCache: jest.fn(), warmIndex: jest.fn(async () => undefined) };
    mockScopeBuild(makeScope(skills));
    const kv = { get: jest.fn(async () => null), put: jest.fn(async () => undefined) };

    await createEdgeMcp({ ...BASE, skillIndex: { binding: 'IDX' } } as EdgeMcpConfig).fetch(new Request('https://w/'), {
      IDX: kv,
    });

    expect(skills.setIndexCache).toHaveBeenCalledTimes(1);
    expect(skills.warmIndex).toHaveBeenCalledTimes(1);
  });

  it('resolves a factory-form skillIndex against env', async () => {
    const skills: FakeSkills = { setIndexCache: jest.fn(), warmIndex: jest.fn(async () => undefined) };
    mockScopeBuild(makeScope(skills));
    const cache = { get: jest.fn(), set: jest.fn() };
    const factory = jest.fn(() => cache);

    await createEdgeMcp({ ...BASE, skillIndex: factory } as unknown as EdgeMcpConfig).fetch(new Request('https://w/'), {
      anything: 1,
    });

    expect(factory).toHaveBeenCalledWith({ anything: 1 });
    expect(skills.setIndexCache).toHaveBeenCalledWith(cache);
  });

  it('skips wiring when the factory yields no cache', async () => {
    const skills: FakeSkills = { setIndexCache: jest.fn(), warmIndex: jest.fn(async () => undefined) };
    mockScopeBuild(makeScope(skills));

    await createEdgeMcp({ ...BASE, skillIndex: () => undefined } as unknown as EdgeMcpConfig).fetch(
      new Request('https://w/'),
    );
    expect(skills.setIndexCache).not.toHaveBeenCalled();
  });

  it('skips wiring when the scope skills registry lacks the cache hooks', async () => {
    // scope.skills present but missing setIndexCache/warmIndex → graceful skip.
    mockScopeBuild({ skills: {} });
    const edge = createEdgeMcp({ ...BASE, skillIndex: { binding: 'IDX' } } as EdgeMcpConfig);
    await expect(edge.fetch(new Request('https://w/'), { IDX: { get: jest.fn(), put: jest.fn() } })).resolves.toBeDefined();
  });

  it('swallows a warmIndex failure so a KV hiccup never bricks boot', async () => {
    const skills: FakeSkills = {
      setIndexCache: jest.fn(),
      warmIndex: jest.fn(async () => {
        throw new Error('kv hiccup');
      }),
    };
    mockScopeBuild(makeScope(skills));
    const edge = createEdgeMcp({ ...BASE, skillIndex: { binding: 'IDX' } } as EdgeMcpConfig);

    const res = await edge.fetch(new Request('https://w/'), { IDX: { get: jest.fn(), put: jest.fn() } });
    expect(res.status).toBe(200);
    expect(skills.warmIndex).toHaveBeenCalled();
  });
});

// ---- managed mode ----------------------------------------------------------

describe('createEdgeMcp — managed mode', () => {
  it('exposes a scheduled handler and lazily loads + inits the plugin on first build', async () => {
    mockScopeBuild(makeScope());
    const edge = createEdgeMcp({ ...BASE, managed: MANAGED } as EdgeMcpConfig);

    expect(typeof edge.scheduled).toBe('function');
    // No plugin load until the first request/cron.
    expect(pluginInit).not.toHaveBeenCalled();

    await edge.fetch(new Request('https://w/'), {});
    expect(pluginInit).toHaveBeenCalledTimes(1);

    // The plugin + the runtime-deps provider are merged into the config.
    const cfg = createForGraph.mock.calls[0][0] as { plugins?: unknown[]; providers?: Array<{ provide: symbol }> };
    expect(cfg.plugins).toContainEqual({ __plugin: true });
    const provider = (cfg.providers ?? []).find((p) => typeof p.provide === 'symbol');
    expect(provider).toBeDefined();
  });

  it('scheduled() builds the scope then refreshes via the attached source', async () => {
    mockScopeBuild(makeScope());
    // Capture the controller passed to the plugin provider and attach a source.
    let attachedRefresh: jest.Mock | undefined;
    createForGraph.mockImplementation(async (cfg: { providers?: Array<{ provide: symbol; useValue: unknown }> }) => {
      const provider = (cfg.providers ?? []).find((p) => typeof p.provide === 'symbol');
      const controller = provider?.useValue as { attach: (s: { refresh: jest.Mock }) => void };
      attachedRefresh = jest.fn(async () => ({ refreshed: true }));
      controller.attach({ refresh: attachedRefresh });
      return { getScopes: () => [makeScope()] };
    });

    const edge = createEdgeMcp({ ...BASE, managed: MANAGED } as EdgeMcpConfig);
    if (!edge.scheduled) throw new Error('expected scheduled handler in managed mode');
    await edge.scheduled({}, { SECRET: 'x' });

    expect(createForGraph).toHaveBeenCalledTimes(1);
    expect(attachedRefresh).toHaveBeenCalledTimes(1);
  });

  it('scheduled() throws when no bundle source was attached (controller has no source)', async () => {
    // createForGraph builds a scope but the provider/controller never gets a source attached.
    mockScopeBuild(makeScope());
    const edge = createEdgeMcp({ ...BASE, managed: MANAGED } as EdgeMcpConfig);
    if (!edge.scheduled) throw new Error('expected scheduled handler in managed mode');

    await expect(edge.scheduled({}, {})).rejects.toBeInstanceOf(Error);
    await expect(edge.scheduled({}, {})).rejects.toThrow(/no bundle source attached/);
  });

  it('resolves a managed.cache factory against env into the controller', async () => {
    const store = { read: jest.fn(), write: jest.fn() };
    const cacheFactory = jest.fn(() => store);
    let controllerCache: unknown;
    createForGraph.mockImplementation(async (cfg: { providers?: Array<{ provide: symbol; useValue: unknown }> }) => {
      const provider = (cfg.providers ?? []).find((p) => typeof p.provide === 'symbol');
      controllerCache = (provider?.useValue as { cache?: unknown }).cache;
      return { getScopes: () => [makeScope()] };
    });

    const edge = createEdgeMcp({
      ...BASE,
      managed: { ...MANAGED, cache: cacheFactory },
    } as unknown as EdgeMcpConfig);
    await edge.fetch(new Request('https://w/'), { ENV: 1 });

    expect(cacheFactory).toHaveBeenCalledWith({ ENV: 1 });
    expect(controllerCache).toBe(store);
  });

  it('passes a plain managed.cache store through unchanged', async () => {
    const store = { read: jest.fn(), write: jest.fn() };
    let controllerCache: unknown;
    createForGraph.mockImplementation(async (cfg: { providers?: Array<{ provide: symbol; useValue: unknown }> }) => {
      const provider = (cfg.providers ?? []).find((p) => typeof p.provide === 'symbol');
      controllerCache = (provider?.useValue as { cache?: unknown }).cache;
      return { getScopes: () => [makeScope()] };
    });

    const edge = createEdgeMcp({
      ...BASE,
      managed: { ...MANAGED, cache: store },
    } as unknown as EdgeMcpConfig);
    await edge.fetch(new Request('https://w/'), {});

    expect(controllerCache).toBe(store);
  });
});

// ---- Durable Object scope builder ------------------------------------------

describe('createEdgeMcp — Durable Object buildScope', () => {
  it('hands the DO factory a buildScope that produces a scope via createForGraph', async () => {
    mockScopeBuild(makeScope());
    createEdgeMcp(BASE);
    const buildScope = createEdgeSessionDurableObject.mock.calls[0][0] as (env: unknown) => Promise<unknown>;
    const scope = await buildScope({ SECRET: 's' });
    expect(scope).toBeDefined();
    expect(createForGraph).toHaveBeenCalled();
  });
});

// ---- public barrel re-exports ----------------------------------------------

describe('index barrel re-exports', () => {
  const kv = {
    store: new Map<string, string>(),
    async get(key: string): Promise<string | null> {
      return this.store.has(key) ? (this.store.get(key) as string) : null;
    },
    async put(key: string, value: string): Promise<void> {
      this.store.set(key, value);
    },
  };

  it('re-exports the bundle-cache helpers from the package root', async () => {
    const cache = createKvBundleCache(kv);
    await cache.write({ a: 1 });
    expect(await cache.read()).toEqual({ a: 1 });
    expect(kvBundleCacheFromEnv('MISSING')({})).toBeUndefined();
  });

  it('re-exports the skill-index-cache helpers from the package root', async () => {
    const cache = createKvSkillIndexCache(kv);
    await cache.set('h', { v: 2 });
    expect(await cache.get('h')).toEqual({ v: 2 });
    expect(kvSkillIndexCacheFromEnv('MISSING')({})).toBeUndefined();
  });

  it('re-exports buildManagedOpenApiPluginOptions, forwarding every optional flag', () => {
    // Exercises the optional-field branches (enableWebhook / outbound /
    // bundleCacheDir) that the mapping otherwise skips.
    const opts = buildManagedOpenApiPluginOptions({
      ...MANAGED,
      enableWebhook: true,
      trustedKeys: [{ kid: 'k' }],
      outbound: { allowlist: ['api.example.com'] },
      bundleCacheDir: '/tmp/bundle',
    });
    expect((opts['source'] as Record<string, unknown>)['enableWebhook']).toBe(true);
    expect(opts['trustedKeys']).toEqual([{ kid: 'k' }]);
    expect(opts['outbound']).toEqual({ allowlist: ['api.example.com'] });
    expect(opts['bundleCacheDir']).toBe('/tmp/bundle');
  });
});
