/**
 * Memory Storage Adapter Tests
 */
import { MemoryStorageAdapter } from '../adapters/memory';
import { StorageNotConnectedError, StorageOperationError } from '../errors';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter({ enableSweeper: false });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('Connection Lifecycle', () => {
    it('should connect successfully', async () => {
      const newAdapter = new MemoryStorageAdapter();
      expect(await newAdapter.ping()).toBe(false);

      await newAdapter.connect();
      expect(await newAdapter.ping()).toBe(true);

      await newAdapter.disconnect();
    });

    it('should handle multiple connects gracefully', async () => {
      await adapter.connect();
      await adapter.connect();
      expect(await adapter.ping()).toBe(true);
    });

    it('should disconnect and clear data', async () => {
      await adapter.set('key', 'value');
      await adapter.disconnect();

      expect(await adapter.ping()).toBe(false);

      // Reconnect and verify data is cleared
      await adapter.connect();
      expect(await adapter.get('key')).toBeNull();
    });

    it('should handle multiple disconnects gracefully', async () => {
      await adapter.disconnect();
      await adapter.disconnect();
      expect(await adapter.ping()).toBe(false);
    });
  });

  describe('Core Operations', () => {
    describe('get/set', () => {
      it('should set and get a value', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.get('key')).toBe('value');
      });

      it('should return null for non-existent key', async () => {
        expect(await adapter.get('nonexistent')).toBeNull();
      });

      it('should overwrite existing value', async () => {
        await adapter.set('key', 'value1');
        await adapter.set('key', 'value2');
        expect(await adapter.get('key')).toBe('value2');
      });

      it('should handle empty string values', async () => {
        await adapter.set('key', '');
        expect(await adapter.get('key')).toBe('');
      });

      it('should handle JSON strings', async () => {
        const json = JSON.stringify({ name: 'John', age: 30 });
        await adapter.set('user', json);
        expect(await adapter.get('user')).toBe(json);
      });
    });

    describe('delete', () => {
      it('should delete existing key', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.delete('key')).toBe(true);
        expect(await adapter.get('key')).toBeNull();
      });

      it('should return false for non-existent key', async () => {
        expect(await adapter.delete('nonexistent')).toBe(false);
      });
    });

    describe('exists', () => {
      it('should return true for existing key', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.exists('key')).toBe(true);
      });

      it('should return false for non-existent key', async () => {
        expect(await adapter.exists('nonexistent')).toBe(false);
      });
    });

    describe('conditional set (NX/XX)', () => {
      it('should set only if not exists (NX)', async () => {
        await adapter.set('key', 'value1', { ifNotExists: true });
        expect(await adapter.get('key')).toBe('value1');

        await adapter.set('key', 'value2', { ifNotExists: true });
        expect(await adapter.get('key')).toBe('value1'); // Not changed
      });

      it('should set only if exists (XX)', async () => {
        await adapter.set('key', 'value1', { ifExists: true });
        expect(await adapter.get('key')).toBeNull(); // Not set

        await adapter.set('key', 'value1');
        await adapter.set('key', 'value2', { ifExists: true });
        expect(await adapter.get('key')).toBe('value2'); // Changed
      });
    });
  });

  describe('TTL Operations', () => {
    describe('set with TTL', () => {
      it('should expire key after TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        expect(await adapter.get('key')).toBe('value');

        // Wait for expiration
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await adapter.get('key')).toBeNull();
      });

      it('should return null for expired key on exists check', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        expect(await adapter.exists('key')).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await adapter.exists('key')).toBe(false);
      });
    });

    describe('expire', () => {
      it('should update TTL on existing key', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.expire('key', 2)).toBe(true);

        const ttl = await adapter.ttl('key');
        expect(ttl).toBeLessThanOrEqual(2);
        expect(ttl).toBeGreaterThan(0);
      });

      it('should return false for non-existent key', async () => {
        expect(await adapter.expire('nonexistent', 60)).toBe(false);
      });

      it('should return false for expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await adapter.expire('key', 60)).toBe(false);
      });
    });

    describe('ttl', () => {
      it('should return remaining TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 60 });
        const ttl = await adapter.ttl('key');
        expect(ttl).toBeLessThanOrEqual(60);
        expect(ttl).toBeGreaterThan(58);
      });

      it('should return -1 for key without TTL', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.ttl('key')).toBe(-1);
      });

      it('should return null for non-existent key', async () => {
        expect(await adapter.ttl('nonexistent')).toBeNull();
      });

      it('should return null for expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await adapter.ttl('key')).toBeNull();
      });
    });
  });

  describe('Batch Operations', () => {
    describe('mget', () => {
      it('should get multiple values', async () => {
        await adapter.set('key1', 'value1');
        await adapter.set('key2', 'value2');

        const values = await adapter.mget(['key1', 'key2', 'key3']);
        expect(values).toEqual(['value1', 'value2', null]);
      });

      it('should preserve order', async () => {
        await adapter.set('a', '1');
        await adapter.set('b', '2');
        await adapter.set('c', '3');

        const values = await adapter.mget(['c', 'a', 'b']);
        expect(values).toEqual(['3', '1', '2']);
      });

      it('should handle empty array', async () => {
        const values = await adapter.mget([]);
        expect(values).toEqual([]);
      });
    });

    describe('mset', () => {
      it('should set multiple values', async () => {
        await adapter.mset([
          { key: 'key1', value: 'value1' },
          { key: 'key2', value: 'value2' },
        ]);

        expect(await adapter.get('key1')).toBe('value1');
        expect(await adapter.get('key2')).toBe('value2');
      });

      it('should set with TTL', async () => {
        await adapter.mset([
          { key: 'key1', value: 'value1', options: { ttlSeconds: 1 } },
          { key: 'key2', value: 'value2' },
        ]);

        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await adapter.get('key1')).toBeNull();
        expect(await adapter.get('key2')).toBe('value2');
      });

      it('should handle empty array', async () => {
        await adapter.mset([]);
        // Should not throw
      });
    });

    describe('mdelete', () => {
      it('should delete multiple keys', async () => {
        await adapter.set('key1', 'value1');
        await adapter.set('key2', 'value2');
        await adapter.set('key3', 'value3');

        const deleted = await adapter.mdelete(['key1', 'key2', 'key4']);
        expect(deleted).toBe(2);
        expect(await adapter.get('key1')).toBeNull();
        expect(await adapter.get('key2')).toBeNull();
        expect(await adapter.get('key3')).toBe('value3');
      });

      it('should handle empty array', async () => {
        const deleted = await adapter.mdelete([]);
        expect(deleted).toBe(0);
      });
    });
  });

  describe('Key Enumeration', () => {
    beforeEach(async () => {
      await adapter.set('user:1:profile', 'data1');
      await adapter.set('user:2:profile', 'data2');
      await adapter.set('user:1:settings', 'data3');
      await adapter.set('session:abc', 'data4');
    });

    describe('keys', () => {
      it('should return all keys with default pattern', async () => {
        const keys = await adapter.keys();
        expect(keys).toHaveLength(4);
        expect(keys).toContain('user:1:profile');
        expect(keys).toContain('session:abc');
      });

      it('should filter with prefix pattern', async () => {
        const keys = await adapter.keys('user:*');
        expect(keys).toHaveLength(3);
        expect(keys).toContain('user:1:profile');
        expect(keys).toContain('user:2:profile');
        expect(keys).toContain('user:1:settings');
      });

      it('should filter with suffix pattern', async () => {
        const keys = await adapter.keys('*:profile');
        expect(keys).toHaveLength(2);
        expect(keys).toContain('user:1:profile');
        expect(keys).toContain('user:2:profile');
      });

      it('should filter with middle pattern', async () => {
        const keys = await adapter.keys('user:1:*');
        expect(keys).toHaveLength(2);
        expect(keys).toContain('user:1:profile');
        expect(keys).toContain('user:1:settings');
      });

      it('should exclude expired keys', async () => {
        await adapter.set('temp', 'data', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        const keys = await adapter.keys();
        expect(keys).not.toContain('temp');
      });
    });

    describe('count', () => {
      it('should count all keys', async () => {
        expect(await adapter.count()).toBe(4);
      });

      it('should count with pattern', async () => {
        expect(await adapter.count('user:*')).toBe(3);
        expect(await adapter.count('session:*')).toBe(1);
      });
    });
  });

  describe('Atomic Operations', () => {
    describe('incr', () => {
      it('should create key with value 1 if not exists', async () => {
        expect(await adapter.incr('counter')).toBe(1);
        expect(await adapter.get('counter')).toBe('1');
      });

      it('should increment existing value', async () => {
        await adapter.set('counter', '5');
        expect(await adapter.incr('counter')).toBe(6);
      });

      it('should throw for non-integer value', async () => {
        await adapter.set('key', 'not-a-number');
        await expect(adapter.incr('key')).rejects.toThrow(StorageOperationError);
      });
    });

    describe('decr', () => {
      it('should create key with value -1 if not exists', async () => {
        expect(await adapter.decr('counter')).toBe(-1);
      });

      it('should decrement existing value', async () => {
        await adapter.set('counter', '5');
        expect(await adapter.decr('counter')).toBe(4);
      });

      it('should go negative', async () => {
        await adapter.set('counter', '0');
        expect(await adapter.decr('counter')).toBe(-1);
      });
    });

    describe('incrBy', () => {
      it('should increment by specified amount', async () => {
        await adapter.set('counter', '10');
        expect(await adapter.incrBy('counter', 5)).toBe(15);
      });

      it('should handle negative amount', async () => {
        await adapter.set('counter', '10');
        expect(await adapter.incrBy('counter', -3)).toBe(7);
      });

      it('should create key if not exists', async () => {
        expect(await adapter.incrBy('counter', 10)).toBe(10);
      });

      it('should preserve TTL after increment', async () => {
        await adapter.set('counter', '10', { ttlSeconds: 60 });
        await adapter.incrBy('counter', 5);

        const ttl = await adapter.ttl('counter');
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });
    });
  });

  describe('Pub/Sub', () => {
    it('should support pub/sub', () => {
      expect(adapter.supportsPubSub()).toBe(true);
    });

    it('should publish and receive messages', async () => {
      const received: string[] = [];

      const unsubscribe = await adapter.subscribe('test-channel', (message) => {
        received.push(message);
      });

      await adapter.publish('test-channel', 'message1');
      await adapter.publish('test-channel', 'message2');

      expect(received).toEqual(['message1', 'message2']);

      await unsubscribe();
    });

    it('should return subscriber count on publish', async () => {
      const unsub1 = await adapter.subscribe('channel', () => {});
      const unsub2 = await adapter.subscribe('channel', () => {});

      const count = await adapter.publish('channel', 'test');
      expect(count).toBe(2);

      await unsub1();
      await unsub2();
    });

    it('should return 0 when no subscribers', async () => {
      const count = await adapter.publish('empty-channel', 'test');
      expect(count).toBe(0);
    });

    it('should stop receiving after unsubscribe', async () => {
      const received: string[] = [];

      const unsubscribe = await adapter.subscribe('channel', (message) => {
        received.push(message);
      });

      await adapter.publish('channel', 'before');
      await unsubscribe();
      await adapter.publish('channel', 'after');

      expect(received).toEqual(['before']);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when max reached', async () => {
      const lruAdapter = new MemoryStorageAdapter({ maxEntries: 3, enableSweeper: false });
      await lruAdapter.connect();

      await lruAdapter.set('key1', 'value1');
      await lruAdapter.set('key2', 'value2');
      await lruAdapter.set('key3', 'value3');
      await lruAdapter.set('key4', 'value4'); // Should evict key1

      expect(await lruAdapter.get('key1')).toBeNull();
      expect(await lruAdapter.get('key2')).toBe('value2');
      expect(await lruAdapter.get('key3')).toBe('value3');
      expect(await lruAdapter.get('key4')).toBe('value4');

      await lruAdapter.disconnect();
    });

    it('should update access order on get', async () => {
      const lruAdapter = new MemoryStorageAdapter({ maxEntries: 3, enableSweeper: false });
      await lruAdapter.connect();

      await lruAdapter.set('key1', 'value1');
      await lruAdapter.set('key2', 'value2');
      await lruAdapter.set('key3', 'value3');

      // Access key1, making key2 the oldest
      await lruAdapter.get('key1');

      await lruAdapter.set('key4', 'value4'); // Should evict key2

      expect(await lruAdapter.get('key1')).toBe('value1');
      expect(await lruAdapter.get('key2')).toBeNull();
      expect(await lruAdapter.get('key3')).toBe('value3');
      expect(await lruAdapter.get('key4')).toBe('value4');

      await lruAdapter.disconnect();
    });
  });

  describe('Error Handling', () => {
    it('should throw when not connected', async () => {
      const disconnectedAdapter = new MemoryStorageAdapter();

      await expect(disconnectedAdapter.get('key')).rejects.toThrow(StorageNotConnectedError);
      await expect(disconnectedAdapter.set('key', 'value')).rejects.toThrow(StorageNotConnectedError);
      await expect(disconnectedAdapter.delete('key')).rejects.toThrow(StorageNotConnectedError);
    });
  });

  describe('Stats', () => {
    it('should return storage statistics', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');

      const stats = adapter.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxEntries).toBe(0); // Unlimited
      expect(stats.sweeperActive).toBe(false);
    });

    it('should show sweeper status', async () => {
      const sweeperAdapter = new MemoryStorageAdapter({ enableSweeper: true, sweepIntervalSeconds: 60 });
      await sweeperAdapter.connect();

      const stats = sweeperAdapter.getStats();
      expect(stats.sweeperActive).toBe(true);

      await sweeperAdapter.disconnect();
    });
  });
});
