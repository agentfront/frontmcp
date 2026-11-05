/**
 * Edge (V8-isolate) behavior of SaasPullSource — slice 1 of edge auto-update:
 *   - a pluggable `cache` replaces the disk cache (no `fs` on a Worker),
 *   - `disablePolling` skips the `setInterval` loop (Workers have no background
 *     execution; a Cron Trigger / DO alarm drives refresh instead),
 *   - `refresh()` is the manual, Cron-driven pull (fetch → notify, resolving once listeners are done),
 *   - the cache holds only the bundles the plugin keeps, after applying them.
 */
import type { ResolvedBundle } from '../bundle/bundle.types';
import type { SaasSourceOptions } from '../source-options';
import { SaasPullSource } from '../sources/saas-pull.source';
import type { BundleCacheStore, BundleSourceDeps } from '../sources/skill-bundle-source.interface';
import { createSaasTokenIssuer, withSaasJwks, type SaasTokenIssuer } from './saas-token.fixture';

// The pull token is verified against the SaaS's JWKS before every pull.
let issuer: SaasTokenIssuer;
let pullToken: string;
beforeAll(async () => {
  issuer = await createSaasTokenIssuer();
  pullToken = await issuer.token();
});

const baseBundle: ResolvedBundle = {
  schemaVersion: 1,
  bundleId: 'saas:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'd'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' as const } },
  skills: [{ id: 's', name: 'S', description: 'd', instructions: '# X', operationIds: [] }],
  operations: {},
} as unknown as ResolvedBundle;

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

const options = (overrides: Partial<SaasSourceOptions> = {}): SaasSourceOptions =>
  ({
    type: 'saas',
    endpoint: 'https://cloud.example.dev/v1/bundles/acme',
    authToken: pullToken,
    expectedAudience: 'acme:prod',
    pollIntervalMs: 30,
    enableWebhook: false,
    jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
    expectedIssuer: 'https://cloud.example.dev',
    ...overrides,
  }) as SaasSourceOptions;

function memoryCache(seed?: ResolvedBundle): BundleCacheStore & { reads: number; writes: number } {
  let stored = seed;
  return {
    reads: 0,
    writes: 0,
    async read() {
      this.reads++;
      return stored;
    },
    async write(b) {
      this.writes++;
      stored = b;
    },
  };
}

class EdgeFakeSource extends SaasPullSource {
  constructor(
    opts: SaasSourceOptions,
    public stub: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>,
    deps: BundleSourceDeps,
  ) {
    super(opts, undefined, fakeLogger, deps);
  }
  protected override async httpGet(url: string, headers: Record<string, string>) {
    return withSaasJwks(issuer, this.stub)(url, headers);
  }
}

const ok = async () => ({ status: 200, body: JSON.stringify(baseBundle) });
const fail = async () => {
  throw new Error('network down');
};

describe('SaasPullSource — edge (worker-safe + Cron-refreshable)', () => {
  it('keeps a bundle in the injected cache, not on the filesystem, and only when asked to', async () => {
    const cache = memoryCache();
    const src = new EdgeFakeSource(options(), ok, { cache, disablePolling: true });
    const seen: ResolvedBundle[] = [];
    src.onChange((b) => seen.push(b));

    await src.start();
    const writesAfterPull = cache.writes;
    await src.keepBundle(seen[0]);

    expect(writesAfterPull).toBe(0);
    expect(cache.writes).toBe(1);
    expect(await cache.read()).toBe(seen[0]);
    await src.stop();
  });

  it('falls back to the injected cache when the boot pull fails (no fs)', async () => {
    const cache = memoryCache(baseBundle); // last-good already in KV
    const src = new EdgeFakeSource(options(), fail, { cache, disablePolling: true });
    const seen: ResolvedBundle[] = [];
    src.onChange((b) => seen.push(b));

    await src.start(); // pull fails → read cache
    expect(cache.reads).toBeGreaterThanOrEqual(1);
    expect(cache.writes).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].bundleId).toBe('saas:test');
    await src.stop();
  });

  it('reads back the bundle the injected cache holds, through the schema check, and writes nothing', async () => {
    const cache = memoryCache(baseBundle);
    const tamperedCache = memoryCache({ ...baseBundle, skills: [{ id: 'x' }] } as unknown as ResolvedBundle);
    const src = new EdgeFakeSource(options(), fail, { cache, disablePolling: true });
    const tamperedSrc = new EdgeFakeSource(options(), fail, { cache: tamperedCache, disablePolling: true });

    const kept = await src.keptBundle();
    const tampered = await tamperedSrc.keptBundle();

    expect(kept).toMatchObject({ bundleId: 'saas:test', version: '1' });
    expect(tampered).toBeUndefined();
    expect([cache.writes, tamperedCache.writes]).toEqual([0, 0]);
  });

  it('names the injected cache, not a file path, when the boot pull fails and the cache is empty (#769)', async () => {
    const src = new EdgeFakeSource(options(), fail, { cache: memoryCache(), disablePolling: true });

    const failure = await src.start().then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure?.message).toContain('no cached bundle is available in the injected bundle cache');
    expect(failure?.message).not.toMatch(/\.json|frontmcp/);
    await src.stop();
  });

  it('refresh() pulls, and resolves once its listener has applied and kept the bundle (Cron path)', async () => {
    const cache = memoryCache();
    const src = new EdgeFakeSource(options(), ok, { cache, disablePolling: true });
    src.onChange(async (b) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await src.keepBundle(b);
    });

    const bundle = await src.refresh();

    expect(bundle?.bundleId).toBe('saas:test');
    expect(cache.writes).toBe(1);
    await src.stop();
  });

  it('refresh() leaves the cache alone when its listener refuses the bundle', async () => {
    const cache = memoryCache(baseBundle);
    const src = new EdgeFakeSource(
      options(),
      async () => ({ status: 200, body: JSON.stringify({ ...baseBundle, version: '2' }) }),
      {
        cache,
        disablePolling: true,
      },
    );
    src.onChange(async () => undefined);

    await src.refresh();

    expect(cache.writes).toBe(0);
    expect((await cache.read())?.version).toBe('1');
    await src.stop();
  });

  it('disablePolling skips the background poll loop', async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { status: 200, body: JSON.stringify(baseBundle) };
    };
    const src = new EdgeFakeSource(options({ pollIntervalMs: 20 }), stub, {
      cache: memoryCache(),
      disablePolling: true,
    });
    await src.start(); // one boot pull
    await new Promise((r) => setTimeout(r, 80)); // > 3 poll intervals
    expect(calls).toBe(1); // no background poll fired
    await src.stop();
  });
});
