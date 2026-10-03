/**
 * `deleteIfEquals()`: a key is deleted only while it still holds the value the caller read.
 */
import { CloudflareKvStorageAdapter } from '../adapters/cloudflare-kv';
import { FileSystemStorageAdapter } from '../adapters/filesystem';
import { MemoryStorageAdapter } from '../adapters/memory';
import { RedisStorageAdapter } from '../adapters/redis';
import { UpstashStorageAdapter } from '../adapters/upstash';
import { VercelKvStorageAdapter } from '../adapters/vercel-kv';
import { StorageNotSupportedError } from '../errors';
import { createRootStorage } from '../namespace';
import type { CloudflareKvNamespace, StorageAdapter } from '../types';
import { COMPARE_AND_DELETE_SCRIPT } from '../utils/compare-and-delete';

/** A Redis whose `eval` runs the compare-and-delete script against an in-memory map. */
function createScriptedRedis() {
  const values = new Map<string, string>();
  const runScript = (script: string, key: string, expectedValue: string): number => {
    if (script !== COMPARE_AND_DELETE_SCRIPT || values.get(key) !== expectedValue) return 0;
    values.delete(key);
    return 1;
  };
  return { values, runScript };
}

const mockUpstashRedis = createScriptedRedis();
const mockVercelRedis = createScriptedRedis();

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn(async (script: string, keys: string[], args: string[]) =>
      mockUpstashRedis.runScript(script, keys[0], args[0]),
    ),
  })),
}));

jest.mock('@vercel/kv', () => {
  const client = {
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn(async (script: string, keys: string[], args: string[]) =>
      mockVercelRedis.runScript(script, keys[0], args[0]),
    ),
  };
  return { kv: client, createClient: jest.fn(() => client) };
});

describe('deleteIfEquals()', () => {
  describe('memory adapter', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it('deletes a key that still holds the expected value', async () => {
      await adapter.set('approval', 'granted');

      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(true);
      await expect(adapter.get('approval')).resolves.toBeNull();
    });

    it('keeps a key that now holds another value', async () => {
      await adapter.set('approval', 'denied');

      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(false);
      await expect(adapter.get('approval')).resolves.toBe('denied');
    });

    it('reports a missing or expired key as not deleted', async () => {
      await adapter.set('approval', 'granted', { ttlSeconds: 1 });
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);

      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(false);
      await expect(adapter.deleteIfEquals('missing', 'granted')).resolves.toBe(false);
      jest.restoreAllMocks();
    });

    it('lets only one of two concurrent calls delete the key', async () => {
      await adapter.set('approval', 'granted');

      const results = await Promise.all([
        adapter.deleteIfEquals('approval', 'granted'),
        adapter.deleteIfEquals('approval', 'granted'),
      ]);

      expect(results.sort()).toEqual([false, true]);
    });
  });

  describe('Redis-protocol adapters', () => {
    it('runs one compare-and-delete script on Redis, with the prefixed key', async () => {
      const redis = createScriptedRedis();
      const client = {
        ping: jest.fn().mockResolvedValue('PONG'),
        eval: jest.fn(async (script: string, _numKeys: number, key: string, expectedValue: string) =>
          redis.runScript(script, key, expectedValue),
        ),
      };
      const adapter = new RedisStorageAdapter({
        client: client as unknown as import('ioredis').Redis,
        keyPrefix: 'app:',
      });
      await adapter.connect();
      redis.values.set('app:approval', 'denied');

      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(false);
      expect(redis.values.get('app:approval')).toBe('denied');
      await expect(adapter.deleteIfEquals('approval', 'denied')).resolves.toBe(true);
      expect(redis.values.has('app:approval')).toBe(false);
      expect(client.eval).toHaveBeenCalledWith(COMPARE_AND_DELETE_SCRIPT, 1, 'app:approval', 'denied');
    });

    it('runs the script on Upstash', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token',
        keyPrefix: 'app:',
      });
      await adapter.connect();
      mockUpstashRedis.values.set('app:approval', 'granted');

      await expect(adapter.deleteIfEquals('approval', 'denied')).resolves.toBe(false);
      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(true);
      expect(mockUpstashRedis.values.has('app:approval')).toBe(false);
    });

    it('runs the script on Vercel KV', async () => {
      const adapter = new VercelKvStorageAdapter({
        url: 'https://example.kv.vercel',
        token: 'token',
        keyPrefix: 'app:',
      });
      await adapter.connect();
      mockVercelRedis.values.set('app:approval', 'granted');

      await expect(adapter.deleteIfEquals('approval', 'denied')).resolves.toBe(false);
      await expect(adapter.deleteIfEquals('approval', 'granted')).resolves.toBe(true);
      expect(mockVercelRedis.values.has('app:approval')).toBe(false);
    });

    it('compares with GET and deletes with DEL inside the script', () => {
      expect(COMPARE_AND_DELETE_SCRIPT).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(COMPARE_AND_DELETE_SCRIPT).toContain("redis.call('DEL', KEYS[1])");
    });
  });

  describe('backends without an atomic compare-and-delete', () => {
    it('refuses on Cloudflare KV', async () => {
      const adapter = new CloudflareKvStorageAdapter({ namespace: {} as CloudflareKvNamespace });

      await expect(adapter.deleteIfEquals('approval', 'granted')).rejects.toThrow(StorageNotSupportedError);
    });

    it('refuses by default, on an adapter that does not implement it', async () => {
      const adapter = new FileSystemStorageAdapter({ baseDir: '/nonexistent' });

      await expect(adapter.deleteIfEquals('approval', 'granted')).rejects.toThrow(StorageNotSupportedError);
    });
  });

  describe('namespaced storage', () => {
    it('prefixes the key', async () => {
      const adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
      const approvals = createRootStorage(adapter).namespace('approval');
      await approvals.set('tool', 'granted');

      await expect(approvals.deleteIfEquals('tool', 'granted')).resolves.toBe(true);
      await expect(adapter.get('approval:tool')).resolves.toBeNull();
      await adapter.disconnect();
    });

    it('refuses over an adapter without deleteIfEquals', async () => {
      const adapter = { get: jest.fn() } as unknown as StorageAdapter;

      await expect(createRootStorage(adapter).deleteIfEquals('tool', 'granted')).rejects.toThrow(
        StorageNotSupportedError,
      );
    });
  });
});
