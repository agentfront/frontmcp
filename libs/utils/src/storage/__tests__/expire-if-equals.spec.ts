/**
 * `expireIfEquals()`: a key's TTL is renewed only while it still holds the value the caller set.
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
import { COMPARE_AND_EXPIRE_SCRIPT } from '../utils/compare-and-delete';

/** A Redis whose `eval` runs the compare-and-expire script against an in-memory map of values and TTLs. */
function createScriptedRedis() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const runScript = (script: string, key: string, expectedValue: string, ttlSeconds: string): number => {
    if (script !== COMPARE_AND_EXPIRE_SCRIPT || values.get(key) !== expectedValue) return 0;
    ttls.set(key, Number(ttlSeconds));
    return 1;
  };
  return { values, ttls, runScript };
}

const mockUpstashRedis = createScriptedRedis();
const mockVercelRedis = createScriptedRedis();

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn(async (script: string, keys: string[], args: string[]) =>
      mockUpstashRedis.runScript(script, keys[0], args[0], args[1]),
    ),
  })),
}));

jest.mock('@vercel/kv', () => {
  const client = {
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn(async (script: string, keys: string[], args: string[]) =>
      mockVercelRedis.runScript(script, keys[0], args[0], args[1]),
    ),
  };
  return { kv: client, createClient: jest.fn(() => client) };
});

describe('expireIfEquals()', () => {
  describe('memory adapter', () => {
    let adapter: MemoryStorageAdapter;
    let startedAt: number;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
      startedAt = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await adapter.disconnect();
    });

    it('renews the TTL of a key that still holds the expected value', async () => {
      await adapter.set('slot', 'ticket-a', { ttlSeconds: 2 });

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 10)).resolves.toBe(true);
      jest.spyOn(Date, 'now').mockReturnValue(startedAt + 5000);
      await expect(adapter.get('slot')).resolves.toBe('ticket-a');
    });

    it('leaves the TTL of a key that now holds another value', async () => {
      await adapter.set('slot', 'ticket-b', { ttlSeconds: 2 });

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 10)).resolves.toBe(false);
      jest.spyOn(Date, 'now').mockReturnValue(startedAt + 5000);
      await expect(adapter.get('slot')).resolves.toBeNull();
    });

    it('reports a missing or expired key as not renewed', async () => {
      await adapter.set('slot', 'ticket-a', { ttlSeconds: 1 });
      jest.spyOn(Date, 'now').mockReturnValue(startedAt + 2000);

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 10)).resolves.toBe(false);
      await expect(adapter.expireIfEquals('missing', 'ticket-a', 10)).resolves.toBe(false);
    });
  });

  describe('Redis-protocol adapters', () => {
    it('runs one compare-and-expire script on Redis, with the prefixed key', async () => {
      const redis = createScriptedRedis();
      const client = {
        ping: jest.fn().mockResolvedValue('PONG'),
        eval: jest.fn(async (script: string, _numKeys: number, key: string, expectedValue: string, ttl: string) =>
          redis.runScript(script, key, expectedValue, ttl),
        ),
      };
      const adapter = new RedisStorageAdapter({
        client: client as unknown as import('ioredis').Redis,
        keyPrefix: 'app:',
      });
      await adapter.connect();
      redis.values.set('app:slot', 'ticket-b');

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 30)).resolves.toBe(false);
      expect(redis.ttls.has('app:slot')).toBe(false);
      await expect(adapter.expireIfEquals('slot', 'ticket-b', 30)).resolves.toBe(true);
      expect(redis.ttls.get('app:slot')).toBe(30);
      expect(client.eval).toHaveBeenCalledWith(COMPARE_AND_EXPIRE_SCRIPT, 1, 'app:slot', 'ticket-b', '30');
    });

    it('runs the script on Upstash', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token',
        keyPrefix: 'app:',
      });
      await adapter.connect();
      mockUpstashRedis.values.set('app:slot', 'ticket-a');

      await expect(adapter.expireIfEquals('slot', 'ticket-b', 30)).resolves.toBe(false);
      await expect(adapter.expireIfEquals('slot', 'ticket-a', 30)).resolves.toBe(true);
      expect(mockUpstashRedis.ttls.get('app:slot')).toBe(30);
    });

    it('runs the script on Vercel KV', async () => {
      const adapter = new VercelKvStorageAdapter({
        url: 'https://example.kv.vercel',
        token: 'token',
        keyPrefix: 'app:',
      });
      await adapter.connect();
      mockVercelRedis.values.set('app:slot', 'ticket-a');

      await expect(adapter.expireIfEquals('slot', 'ticket-b', 30)).resolves.toBe(false);
      await expect(adapter.expireIfEquals('slot', 'ticket-a', 30)).resolves.toBe(true);
      expect(mockVercelRedis.ttls.get('app:slot')).toBe(30);
    });

    it('compares with GET and renews with EXPIRE inside the script', () => {
      expect(COMPARE_AND_EXPIRE_SCRIPT).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(COMPARE_AND_EXPIRE_SCRIPT).toContain("redis.call('EXPIRE', KEYS[1], ARGV[2])");
    });
  });

  describe('backends without an atomic compare-and-expire', () => {
    it('refuses on Cloudflare KV', async () => {
      const adapter = new CloudflareKvStorageAdapter({ namespace: {} as CloudflareKvNamespace });

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 30)).rejects.toThrow(StorageNotSupportedError);
    });

    it('refuses by default, on an adapter that does not implement it', async () => {
      const adapter = new FileSystemStorageAdapter({ baseDir: '/nonexistent' });

      await expect(adapter.expireIfEquals('slot', 'ticket-a', 30)).rejects.toThrow(StorageNotSupportedError);
    });
  });

  describe('namespaced storage', () => {
    it('prefixes the key', async () => {
      const adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
      const slots = createRootStorage(adapter).namespace('guard');
      await slots.set('slot', 'ticket-a', { ttlSeconds: 2 });

      await expect(slots.expireIfEquals('slot', 'ticket-a', 30)).resolves.toBe(true);
      await expect(adapter.ttl('guard:slot')).resolves.toBeGreaterThan(2);
      await adapter.disconnect();
    });

    it('refuses over an adapter without expireIfEquals', async () => {
      const adapter = { get: jest.fn() } as unknown as StorageAdapter;

      await expect(createRootStorage(adapter).expireIfEquals('slot', 'ticket-a', 30)).rejects.toThrow(
        StorageNotSupportedError,
      );
    });
  });
});
