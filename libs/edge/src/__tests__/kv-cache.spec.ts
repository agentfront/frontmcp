/**
 * Unit tests for the KV-backed last-good bundle cache — the worker-safe
 * replacement for the SaaS source's on-disk cache (no filesystem on a Worker).
 */
import { createKvBundleCache, type EdgeKvNamespace, kvBundleCacheFromEnv } from '../kv-cache';

interface PutCall {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

function fakeKv(): EdgeKvNamespace & { store: Map<string, string>; puts: PutCall[] } {
  const store = new Map<string, string>();
  const puts: PutCall[] = [];
  return {
    store,
    puts,
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

describe('createKvBundleCache', () => {
  it('round-trips a bundle through write → read', async () => {
    const kv = fakeKv();
    const cache = createKvBundleCache(kv);
    const bundle = { bundleId: 'b1', version: '3', skills: [{ id: 's' }] };

    await cache.write(bundle);
    const read = await cache.read();

    expect(read).toEqual(bundle);
  });

  it('returns undefined on a cold (missing) key', async () => {
    const cache = createKvBundleCache(fakeKv());
    expect(await cache.read()).toBeUndefined();
  });

  it('returns undefined (not throw) on a corrupt cache entry', async () => {
    const kv = fakeKv();
    kv.store.set('frontmcp:bundle:last-good', '{ not valid json');
    const cache = createKvBundleCache(kv);
    expect(await cache.read()).toBeUndefined();
  });

  it('uses the default key, overridable via options', async () => {
    const kv = fakeKv();
    await createKvBundleCache(kv).write({ a: 1 });
    expect(kv.store.has('frontmcp:bundle:last-good')).toBe(true);

    const kv2 = fakeKv();
    await createKvBundleCache(kv2, { key: 'custom:key' }).write({ a: 1 });
    expect(kv2.store.has('custom:key')).toBe(true);
    expect(await createKvBundleCache(kv2, { key: 'custom:key' }).read()).toEqual({ a: 1 });
  });

  it('passes expirationTtl through to put, and omits options when unset', async () => {
    const kv = fakeKv();
    await createKvBundleCache(kv, { expirationTtl: 600 }).write({ a: 1 });
    expect(kv.puts[0].options).toEqual({ expirationTtl: 600 });

    const kv2 = fakeKv();
    await createKvBundleCache(kv2).write({ a: 1 });
    expect(kv2.puts[0].options).toBeUndefined();
  });
});

describe('kvBundleCacheFromEnv', () => {
  it('resolves the KV namespace from env[binding] at call time', async () => {
    const kv = fakeKv();
    const factory = kvBundleCacheFromEnv('BUNDLE_CACHE');
    const cache = factory({ BUNDLE_CACHE: kv });

    expect(cache).toBeDefined();
    await cache!.write({ bundleId: 'b' });
    expect(kv.store.has('frontmcp:bundle:last-good')).toBe(true);
  });

  it('returns undefined (no crash) when the binding is missing', () => {
    expect(kvBundleCacheFromEnv('MISSING')({})).toBeUndefined();
    expect(kvBundleCacheFromEnv('MISSING')(undefined)).toBeUndefined();
  });

  it('forwards options (key) to the underlying cache', async () => {
    const kv = fakeKv();
    const cache = kvBundleCacheFromEnv('KV', { key: 'k2' })({ KV: kv });
    await cache!.write({ a: 1 });
    expect(kv.store.has('k2')).toBe(true);
  });
});
