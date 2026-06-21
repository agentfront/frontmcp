/**
 * Host runtime-deps injection (the `@frontmcp/edge` integration point).
 *
 * Proves that when a host registers a controller under
 * `SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN`, the plugin's bundle-source factory:
 *   1. feeds the injected cache to the source — so the boot fallback uses KV
 *      (not the filesystem) when a fresh pull fails, and
 *   2. hands the live source back via `attach`, so an external scheduler
 *      (Cloudflare Cron Trigger / DO alarm) can drive `refresh()` to pull +
 *      hot-swap a new bundle.
 *
 * This is the plugin half of the edge auto-update keystone; the
 * SaasPullSource-level behavior (no fs, single-flight, disablePolling) is
 * covered in the adapters' `saas-pull.source.edge.spec.ts`.
 */
import 'reflect-metadata';

import { BundleStore } from '@frontmcp/adapters/skills';

import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import SkilledOpenApiPlugin, {
  SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN,
  type SkilledOpenApiRuntimeDeps,
} from '../skilled-openapi.plugin';
import { BundleSyncService } from '../sync/bundle-sync.service';

const bundle = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  bundleId: 'plugin:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'http://127.0.0.1:9999' }],
  authBindings: { def: { kind: 'none' } },
  skills: [],
  operations: {},
  ...overrides,
});

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

/** A scope stub whose provider registry resolves only the runtime-deps token. */
function scopeWith(controller: SkilledOpenApiRuntimeDeps) {
  return {
    logger: fakeLogger,
    skills: {
      registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })),
      unregisterSkill: jest.fn(async () => false),
    },
    providers: {
      get(token: unknown): unknown {
        if (token === SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN) return controller;
        // Mimic ProviderRegistry#get throwing for unregistered tokens (e.g. the
        // optional telemetry-factory probe), so resolveBundleTelemetry no-ops.
        throw new Error('token not registered');
      },
    },
  };
}

function getSyncFactory() {
  const providers = SkilledOpenApiPlugin.dynamicProviders({
    source: {
      type: 'saas',
      endpoint: 'https://cloud.example.dev/v1/bundles/acme',
      authToken: 'tok',
      expectedAudience: 'acme:prod',
      jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
      expectedIssuer: 'https://cloud.example.dev',
      pollIntervalMs: 20,
    },
    requireSignature: false,
    dev: true,
  });
  return (providers.find((p: { provide: unknown }) => p.provide === BundleSyncService) as {
    useFactory: (...args: unknown[]) => Promise<BundleSyncService>;
  }).useFactory;
}

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !predicate()) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('skilled-openapi runtime-deps injection', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.spyOn(global, 'fetch' as never);
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('feeds the injected cache to the source as boot fallback (no filesystem)', async () => {
    // Network down on boot → the source must fall back to the injected cache.
    fetchMock.mockRejectedValue(new Error('network down'));
    const cached = bundle({ bundleId: 'plugin:cached' });
    const attach = jest.fn();
    const controller: SkilledOpenApiRuntimeDeps = {
      cache: { read: jest.fn(async () => cached as never), write: jest.fn(async () => {}) },
      disablePolling: true,
      attach,
    };

    const store = new BundleStore();
    await getSyncFactory()(scopeWith(controller), new HiddenOpRegistry(), store);

    // The deferred source.start() pulls (fails) → reads the injected cache →
    // applies it through the plugin's sync service.
    await waitFor(() => store.current() != null);
    expect(store.current()?.bundleId).toBe('plugin:cached');
    expect(controller.cache?.read).toHaveBeenCalled();

    // And the live source was handed back, exposing a Cron-drivable refresh().
    expect(attach).toHaveBeenCalledTimes(1);
    const source = attach.mock.calls[0][0] as { refresh?: () => Promise<unknown> };
    expect(typeof source.refresh).toBe('function');
  });

  it('attach exposes a refreshable source that pulls + persists + hot-swaps', async () => {
    // Boot fails → cache fallback (as above), then the Cron path pulls fresh.
    fetchMock.mockRejectedValue(new Error('network down'));
    const cached = bundle({ bundleId: 'plugin:cached', version: '1' });
    const write = jest.fn(async () => {});
    let captured: { refresh?: () => Promise<unknown> } | undefined;
    const controller: SkilledOpenApiRuntimeDeps = {
      cache: { read: jest.fn(async () => cached as never), write },
      disablePolling: true,
      attach: (s) => {
        captured = s as never;
      },
    };

    const store = new BundleStore();
    await getSyncFactory()(scopeWith(controller), new HiddenOpRegistry(), store);
    await waitFor(() => store.current() != null);
    expect(store.current()?.bundleId).toBe('plugin:cached');

    // Cron Trigger fires → fresh bundle now available from the endpoint.
    const fresh = bundle({ bundleId: 'plugin:fresh', version: '2' });
    fetchMock.mockResolvedValue({ status: 200, text: async () => JSON.stringify(fresh) } as never);
    await captured?.refresh?.();

    await waitFor(() => store.current()?.bundleId === 'plugin:fresh');
    expect(store.current()?.bundleId).toBe('plugin:fresh');
    expect(store.current()?.version).toBe('2');
    expect(write).toHaveBeenCalled(); // fresh bundle persisted back to the cache
  });

  it('works without a controller (standard Node path): no attach, fs cache', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(bundle({ bundleId: 'plugin:node' })),
    } as never);

    // No `providers` resolving the token → resolveRuntimeDeps returns undefined.
    const scope = {
      logger: fakeLogger,
      skills: { registerSkillContent: jest.fn(), unregisterSkill: jest.fn() },
    };
    const store = new BundleStore();
    const sync = await getSyncFactory()(scope, new HiddenOpRegistry(), store);
    expect(sync).toBeInstanceOf(BundleSyncService);
    await waitFor(() => store.current() != null);
    expect(store.current()?.bundleId).toBe('plugin:node');
  });
});
