/**
 * `extendTtl()`: a key gets at least the asked TTL, and never a shorter one than it has.
 */
import { MemoryStorageAdapter } from '../adapters/memory';
import { RedisStorageAdapter } from '../adapters/redis';
import { createRootStorage } from '../namespace';
import { EXTEND_TTL_SCRIPT } from '../utils/compare-and-delete';
import { extendTtlByReading } from '../utils/ttl';

describe('extendTtl()', () => {
  describe('memory adapter', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it('lengthens a shorter TTL, and leaves a longer one as it is', async () => {
      await adapter.set('count', '3', { ttlSeconds: 10 });

      await expect(adapter.extendTtl('count', 100)).resolves.toBe(true);
      await expect(adapter.extendTtl('count', 50)).resolves.toBe(false);
      expect(await adapter.ttl('count')).toBeGreaterThan(90);
    });

    it('gives a key without a TTL one, and does nothing for a missing key', async () => {
      await adapter.set('count', '1');

      await expect(adapter.extendTtl('count', 60)).resolves.toBe(true);
      expect(await adapter.ttl('count')).toBeGreaterThan(50);
      await expect(adapter.extendTtl('missing', 60)).resolves.toBe(false);
    });

    it('keeps the longest of interleaved requests, whichever runs last', async () => {
      await adapter.set('count', '1', { ttlSeconds: 5 });
      const storage = createRootStorage(adapter);

      await Promise.all([storage.extendTtl('count', 7200), storage.extendTtl('count', 60)]);

      expect(await adapter.ttl('count')).toBeGreaterThan(7000);
    });
  });

  describe('redis adapter', () => {
    it('checks and sets the TTL in one script', async () => {
      const evalScript = jest.fn().mockResolvedValue(1);
      const client = { eval: evalScript, ping: jest.fn().mockResolvedValue('PONG') };
      const adapter = new RedisStorageAdapter({ client: client as never, keyPrefix: 'p:' });
      await adapter.connect();

      await expect(adapter.extendTtl('count', 90)).resolves.toBe(true);
      expect(evalScript).toHaveBeenCalledWith(EXTEND_TTL_SCRIPT, 1, 'p:count', '90');
    });
  });

  describe('an adapter that cannot check and set in one step', () => {
    it('reads the TTL first and never lowers it', async () => {
      const expire = jest.fn().mockResolvedValue(true);
      const ttlLeft: Record<string, number | null> = { long: 500, short: 5, unbounded: -1, missing: null };
      const adapter = { ttl: async (key: string) => ttlLeft[key], expire };

      await expect(extendTtlByReading(adapter, 'long', 60)).resolves.toBe(false);
      await expect(extendTtlByReading(adapter, 'missing', 60)).resolves.toBe(false);
      await expect(extendTtlByReading(adapter, 'short', 60)).resolves.toBe(true);
      await expect(extendTtlByReading(adapter, 'unbounded', 60)).resolves.toBe(true);
      expect(expire.mock.calls).toEqual([
        ['short', 60],
        ['unbounded', 60],
      ]);
    });
  });
});
