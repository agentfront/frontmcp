/**
 * Unit tests for CloudflareKvStorageAdapter — the StorageAdapter over a
 * Cloudflare Workers KV binding. Drives a faithful in-memory fake KVNamespace
 * (prefix-scoped paginated list, expirationTtl capture) and asserts both the
 * supported operations and the honest NotSupported errors for the operations
 * KV can't do (atomic counters, conditional writes, TTL introspection).
 */
import { StorageNotSupportedError, StorageOperationError } from '../../errors';
import type { CloudflareKvNamespace } from '../../types';
import { CloudflareKvStorageAdapter } from '../cloudflare-kv';

interface PutCall {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

class FakeKv implements CloudflareKvNamespace {
  store = new Map<string, string>();
  puts: PutCall[] = [];
  failList = false;

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.puts.push({ key, value, options });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    if (this.failList) throw new Error('list failed');
    let names = [...this.store.keys()].sort();
    if (opts.prefix) names = names.filter((n) => n.startsWith(opts.prefix as string));
    const start = opts.cursor ? parseInt(opts.cursor, 10) : 0;
    const page = names.slice(start, start + 2); // 2/page to exercise pagination
    const next = start + 2;
    const complete = next >= names.length;
    return {
      keys: page.map((name) => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(next) }),
    };
  }
}

async function mkAdapter(keyPrefix?: string) {
  const kv = new FakeKv();
  const adapter = new CloudflareKvStorageAdapter({ namespace: kv, ...(keyPrefix ? { keyPrefix } : {}) });
  await adapter.connect();
  return { kv, adapter };
}

describe('CloudflareKvStorageAdapter', () => {
  it('throws if constructed without a namespace', () => {
    expect(() => new CloudflareKvStorageAdapter({ namespace: undefined as never })).toThrow(/namespace.*required/i);
  });

  describe('core get/set/delete/exists', () => {
    it('round-trips a value', async () => {
      const { adapter } = await mkAdapter();
      await adapter.set('k', 'v');
      expect(await adapter.get('k')).toBe('v');
      expect(await adapter.exists('k')).toBe(true);
      expect(await adapter.get('missing')).toBeNull();
      expect(await adapter.exists('missing')).toBe(false);
    });

    it('delete reports whether the key existed', async () => {
      const { adapter } = await mkAdapter();
      await adapter.set('k', 'v');
      expect(await adapter.delete('k')).toBe(true);
      expect(await adapter.delete('k')).toBe(false);
    });

    it('applies keyPrefix to the underlying KV but hides it from callers', async () => {
      const { kv, adapter } = await mkAdapter('mcp:');
      await adapter.set('session', 'v');
      expect(kv.store.has('mcp:session')).toBe(true);
      expect(await adapter.keys('*')).toEqual(['session']);
    });
  });

  describe('TTL on set / expire', () => {
    it('passes a >=60s ttl through as expirationTtl', async () => {
      const { kv, adapter } = await mkAdapter();
      await adapter.set('k', 'v', { ttlSeconds: 120 });
      expect(kv.puts.at(-1)?.options).toEqual({ expirationTtl: 120 });
    });

    it('rejects a ttl below the 60s KV minimum', async () => {
      const { adapter } = await mkAdapter();
      await expect(adapter.set('k', 'v', { ttlSeconds: 30 })).rejects.toBeInstanceOf(StorageOperationError);
    });

    it('expire re-puts an existing value with the new ttl; false when missing', async () => {
      const { kv, adapter } = await mkAdapter();
      await adapter.set('k', 'v');
      expect(await adapter.expire('k', 90)).toBe(true);
      expect(kv.puts.at(-1)?.options).toEqual({ expirationTtl: 90 });
      expect(await adapter.expire('missing', 90)).toBe(false);
    });
  });

  describe('keys() over paginated list', () => {
    it('paginates, glob-filters, and unprefixes', async () => {
      const { adapter } = await mkAdapter();
      await adapter.set('user:1', 'a');
      await adapter.set('user:2', 'b');
      await adapter.set('user:3', 'c');
      await adapter.set('session:1', 'd');
      expect((await adapter.keys('user:*')).sort()).toEqual(['user:1', 'user:2', 'user:3']);
      expect(await adapter.keys('session:*')).toEqual(['session:1']);
      expect((await adapter.keys('*')).length).toBe(4);
    });
  });

  describe('ping / connection', () => {
    it('ping is true when list succeeds, false when it throws', async () => {
      const { kv, adapter } = await mkAdapter();
      expect(await adapter.ping()).toBe(true);
      kv.failList = true;
      expect(await adapter.ping()).toBe(false);
    });

    it('operations require connect() first', async () => {
      const adapter = new CloudflareKvStorageAdapter({ namespace: new FakeKv() });
      await expect(adapter.get('k')).rejects.toBeTruthy();
    });
  });

  describe('honest NotSupported for KV-incompatible ops', () => {
    it('rejects conditional writes (ifNotExists/ifExists)', async () => {
      const { adapter } = await mkAdapter();
      await expect(adapter.set('k', 'v', { ifNotExists: true })).rejects.toBeInstanceOf(StorageNotSupportedError);
      await expect(adapter.set('k', 'v', { ifExists: true })).rejects.toBeInstanceOf(StorageNotSupportedError);
    });

    it('rejects atomic counters (incr/decr/incrBy)', async () => {
      const { adapter } = await mkAdapter();
      await expect(adapter.incr('c')).rejects.toBeInstanceOf(StorageNotSupportedError);
      await expect(adapter.decr('c')).rejects.toBeInstanceOf(StorageNotSupportedError);
      await expect(adapter.incrBy('c', 5)).rejects.toBeInstanceOf(StorageNotSupportedError);
    });

    it('rejects ttl introspection', async () => {
      const { adapter } = await mkAdapter();
      await expect(adapter.ttl('k')).rejects.toBeInstanceOf(StorageNotSupportedError);
    });

    it('rejects pub/sub', async () => {
      const { adapter } = await mkAdapter();
      await expect(adapter.publish('c', 'm')).rejects.toBeInstanceOf(StorageNotSupportedError);
    });
  });
});
