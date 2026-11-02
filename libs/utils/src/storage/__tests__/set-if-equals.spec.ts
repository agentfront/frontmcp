/**
 * `setIfEquals()`: a key is replaced only while it still holds the value the caller read.
 */
import { CloudflareKvStorageAdapter } from '../adapters/cloudflare-kv';
import { FileSystemStorageAdapter } from '../adapters/filesystem';
import { MemoryStorageAdapter } from '../adapters/memory';
import { RedisStorageAdapter } from '../adapters/redis';
import { StorageNotSupportedError } from '../errors';
import { createRootStorage } from '../namespace';
import type { CloudflareKvNamespace, StorageAdapter } from '../types';
import { COMPARE_AND_SET_SCRIPT } from '../utils/compare-and-delete';

describe('setIfEquals()', () => {
  describe('memory adapter', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await adapter.disconnect();
    });

    it('replaces a key that still holds the expected value, and drops its TTL', async () => {
      await adapter.set('board', 'v1', { ttlSeconds: 60 });

      await expect(adapter.setIfEquals('board', 'v1', 'v2')).resolves.toBe(true);
      await expect(adapter.get('board')).resolves.toBe('v2');
      await expect(adapter.ttl('board')).resolves.toBe(-1);
    });

    it('keeps a key that now holds another value', async () => {
      await adapter.set('board', 'v3');

      await expect(adapter.setIfEquals('board', 'v1', 'v2')).resolves.toBe(false);
      await expect(adapter.get('board')).resolves.toBe('v3');
    });

    it('reports a missing or expired key as not set', async () => {
      await adapter.set('board', 'v1', { ttlSeconds: 1 });
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);

      await expect(adapter.setIfEquals('board', 'v1', 'v2')).resolves.toBe(false);
      await expect(adapter.setIfEquals('missing', 'v1', 'v2')).resolves.toBe(false);
      await expect(adapter.exists('missing')).resolves.toBe(false);
    });

    it('lets only one of two concurrent calls replace the key', async () => {
      await adapter.set('board', 'v1');

      const results = await Promise.all([
        adapter.setIfEquals('board', 'v1', 'a'),
        adapter.setIfEquals('board', 'v1', 'b'),
      ]);

      expect(results.sort()).toEqual([false, true]);
      await expect(adapter.get('board')).resolves.toBe('a');
    });
  });

  describe('Redis adapter', () => {
    it('runs one compare-and-set script, with the prefixed key', async () => {
      const values = new Map<string, string>([['app:board', 'v1']]);
      const client = {
        ping: jest.fn().mockResolvedValue('PONG'),
        eval: jest.fn(async (script: string, _numKeys: number, key: string, expected: string, next: string) => {
          if (script !== COMPARE_AND_SET_SCRIPT || values.get(key) !== expected) return 0;
          values.set(key, next);
          return 1;
        }),
      };
      const adapter = new RedisStorageAdapter({
        client: client as unknown as import('ioredis').Redis,
        keyPrefix: 'app:',
      });
      await adapter.connect();

      await expect(adapter.setIfEquals('board', 'v0', 'v2')).resolves.toBe(false);
      await expect(adapter.setIfEquals('board', 'v1', 'v2')).resolves.toBe(true);
      expect(values.get('app:board')).toBe('v2');
      expect(client.eval).toHaveBeenCalledWith(COMPARE_AND_SET_SCRIPT, 1, 'app:board', 'v1', 'v2');
    });

    it('compares with GET and writes with SET inside the script', () => {
      expect(COMPARE_AND_SET_SCRIPT).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(COMPARE_AND_SET_SCRIPT).toContain("redis.call('SET', KEYS[1], ARGV[2])");
    });
  });

  describe('backends without an atomic compare-and-set', () => {
    it('refuses on Cloudflare KV', async () => {
      const adapter = new CloudflareKvStorageAdapter({ namespace: {} as CloudflareKvNamespace });

      await expect(adapter.setIfEquals('board', 'v1', 'v2')).rejects.toThrow(StorageNotSupportedError);
    });

    it('refuses by default, on an adapter that does not implement it', async () => {
      const adapter = new FileSystemStorageAdapter({ baseDir: '/nonexistent' });

      await expect(adapter.setIfEquals('board', 'v1', 'v2')).rejects.toThrow(StorageNotSupportedError);
    });
  });

  describe('namespaced storage', () => {
    it('prefixes the key', async () => {
      const adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
      const boards = createRootStorage(adapter).namespace('boards');
      await boards.set('main', 'v1');

      await expect(boards.setIfEquals('main', 'v1', 'v2')).resolves.toBe(true);
      await expect(adapter.get('boards:main')).resolves.toBe('v2');
      await adapter.disconnect();
    });

    it('refuses over an adapter without setIfEquals', async () => {
      const adapter = { get: jest.fn() } as unknown as StorageAdapter;

      await expect(createRootStorage(adapter).setIfEquals('main', 'v1', 'v2')).rejects.toThrow(
        StorageNotSupportedError,
      );
    });
  });
});
