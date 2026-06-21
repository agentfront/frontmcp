/**
 * Unit tests for the KV-backed skill SEARCH-INDEX cache — the worker-safe
 * persistence layer that restores a built TF-IDF/BM25 index on a cold start
 * instead of recomputing the corpus. Mirrors `kv-cache.spec.ts`: a fake KV
 * namespace round-trips snapshots, tolerates cold/corrupt entries, honours the
 * key prefix + TTL, and the `*FromEnv` factory resolves the binding lazily.
 */
import type { EdgeKvNamespace } from '../kv-cache';
import { createKvSkillIndexCache, kvSkillIndexCacheFromEnv } from '../skill-index-cache';

interface PutCall {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

function fakeKv(): EdgeKvNamespace & { store: Map<string, string>; puts: PutCall[]; gets: string[] } {
  const store = new Map<string, string>();
  const puts: PutCall[] = [];
  const gets: string[] = [];
  return {
    store,
    puts,
    gets,
    async get(key: string): Promise<string | null> {
      gets.push(key);
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

describe('createKvSkillIndexCache', () => {
  it('round-trips a snapshot through set → get under the default prefix', async () => {
    const kv = fakeKv();
    const cache = createKvSkillIndexCache(kv);
    const snapshot = { idf: { a: 1 }, vectors: [[0.1, 0.2]], hash: 'h1' };

    await cache.set('content-hash', snapshot);
    expect(kv.store.has('frontmcp:skill-index:content-hash')).toBe(true);

    const read = await cache.get('content-hash');
    expect(read).toEqual(snapshot);
  });

  it('returns undefined on a cold (missing) key', async () => {
    const cache = createKvSkillIndexCache(fakeKv());
    expect(await cache.get('nope')).toBeUndefined();
  });

  it('returns undefined (not throw) on a corrupt snapshot entry', async () => {
    const kv = fakeKv();
    kv.store.set('frontmcp:skill-index:bad', '{ not: valid');
    const cache = createKvSkillIndexCache(kv);
    expect(await cache.get('bad')).toBeUndefined();
  });

  it('applies a custom key prefix to both reads and writes', async () => {
    const kv = fakeKv();
    const cache = createKvSkillIndexCache(kv, { keyPrefix: 'idx:' });

    await cache.set('k', { v: 1 });
    expect(kv.store.has('idx:k')).toBe(true);
    expect(await cache.get('k')).toEqual({ v: 1 });
    expect(kv.gets).toContain('idx:k');
  });

  it('passes expirationTtl through to put, and omits options when unset', async () => {
    const kv = fakeKv();
    await createKvSkillIndexCache(kv, { expirationTtl: 1200 }).set('k', { v: 1 });
    expect(kv.puts[0].options).toEqual({ expirationTtl: 1200 });

    const kv2 = fakeKv();
    await createKvSkillIndexCache(kv2).set('k', { v: 1 });
    expect(kv2.puts[0].options).toBeUndefined();
  });
});

describe('kvSkillIndexCacheFromEnv', () => {
  it('resolves the KV namespace from env[binding] at call time', async () => {
    const kv = fakeKv();
    const factory = kvSkillIndexCacheFromEnv('FRONTMCP_SKILL_INDEX');
    const cache = factory({ FRONTMCP_SKILL_INDEX: kv });

    expect(cache).toBeDefined();
    if (!cache) throw new Error('Expected cache from FRONTMCP_SKILL_INDEX binding');
    await cache.set('h', { v: 1 });
    expect(kv.store.has('frontmcp:skill-index:h')).toBe(true);
  });

  it('returns undefined (no crash) when the binding is missing', () => {
    expect(kvSkillIndexCacheFromEnv('MISSING')({})).toBeUndefined();
    expect(kvSkillIndexCacheFromEnv('MISSING')(undefined)).toBeUndefined();
  });

  it('forwards options (keyPrefix + ttl) to the underlying cache', async () => {
    const kv = fakeKv();
    const cache = kvSkillIndexCacheFromEnv('KV', { keyPrefix: 'p:', expirationTtl: 60 })({ KV: kv });
    if (!cache) throw new Error('Expected cache from KV binding');
    await cache.set('x', { v: 1 });
    expect(kv.store.has('p:x')).toBe(true);
    expect(kv.puts[0].options).toEqual({ expirationTtl: 60 });
  });
});
