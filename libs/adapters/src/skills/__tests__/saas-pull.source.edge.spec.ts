/**
 * Edge (V8-isolate) behavior of SaasPullSource — slice 1 of edge auto-update:
 *   - a pluggable `cache` replaces the disk cache (no `fs` on a Worker),
 *   - `disablePolling` skips the `setInterval` loop (Workers have no background
 *     execution; a Cron Trigger / DO alarm drives refresh instead),
 *   - `refresh()` is the manual, Cron-driven pull (fetch → cache → notify).
 */
import type { ResolvedBundle } from '../bundle/bundle.types';
import type { SaasSourceOptions } from '../source-options';
import { SaasPullSource } from '../sources/saas-pull.source';
import type { BundleCacheStore, BundleSourceDeps } from '../sources/skill-bundle-source.interface';

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
    authToken: 'tok',
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
    return this.stub(url, headers);
  }
}

const ok = async () => ({ status: 200, body: JSON.stringify(baseBundle) });
const fail = async () => {
  throw new Error('network down');
};

describe('SaasPullSource — edge (worker-safe + Cron-refreshable)', () => {
  it('uses the injected cache instead of the filesystem', async () => {
    const cache = memoryCache();
    const src = new EdgeFakeSource(options(), ok, { cache, disablePolling: true });
    const seen: ResolvedBundle[] = [];
    src.onChange((b) => seen.push(b));

    await src.start();
    expect(cache.writes).toBe(1); // persisted to KV-like cache, not fs
    expect(seen).toHaveLength(1);
    await src.stop();
  });

  it('falls back to the injected cache when the boot pull fails (no fs)', async () => {
    const cache = memoryCache(baseBundle); // last-good already in KV
    const src = new EdgeFakeSource(options(), fail, { cache, disablePolling: true });
    const seen: ResolvedBundle[] = [];
    src.onChange((b) => seen.push(b));

    await src.start(); // pull fails → read cache
    expect(cache.reads).toBeGreaterThanOrEqual(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].bundleId).toBe('saas:test');
    await src.stop();
  });

  it('refresh() pulls, persists to cache, and notifies (Cron path)', async () => {
    const cache = memoryCache();
    const src = new EdgeFakeSource(options(), ok, { cache, disablePolling: true });
    const seen: ResolvedBundle[] = [];
    src.onChange((b) => seen.push(b));

    const bundle = await src.refresh();
    expect(bundle?.bundleId).toBe('saas:test');
    expect(cache.writes).toBe(1);
    expect(seen).toHaveLength(1);
    await src.stop();
  });

  it('disablePolling skips the background poll loop', async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { status: 200, body: JSON.stringify(baseBundle) };
    };
    const src = new EdgeFakeSource(options({ pollIntervalMs: 20 }), stub, { cache: memoryCache(), disablePolling: true });
    await src.start(); // one boot pull
    await new Promise((r) => setTimeout(r, 80)); // > 3 poll intervals
    expect(calls).toBe(1); // no background poll fired
    await src.stop();
  });
});
