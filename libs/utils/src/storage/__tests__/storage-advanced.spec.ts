/**
 * Advanced Storage Tests
 *
 * Comprehensive tests for edge cases, concurrent operations,
 * advanced features, and error scenarios.
 */
import { MemoryStorageAdapter } from '../adapters/memory';
import { StorageNotConnectedError, StorageOperationError, StorageTTLError, StoragePatternError } from '../errors';
import { createNamespacedStorage, createRootStorage } from '../namespace';
import type { NamespacedStorage } from '../types';

describe('Advanced Storage Tests', () => {
  describe('SetOptions - Conditional Operations', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('ifNotExists (NX)', () => {
      it('should set value when key does not exist', async () => {
        await adapter.set('key', 'value', { ifNotExists: true });
        expect(await adapter.get('key')).toBe('value');
      });

      it('should not overwrite existing key', async () => {
        await adapter.set('key', 'original');
        await adapter.set('key', 'new-value', { ifNotExists: true });
        expect(await adapter.get('key')).toBe('original');
      });

      it('should set when existing key is expired', async () => {
        await adapter.set('key', 'expired', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        await adapter.set('key', 'new-value', { ifNotExists: true });
        expect(await adapter.get('key')).toBe('new-value');
      });

      it('should work with TTL option', async () => {
        await adapter.set('key', 'value', { ifNotExists: true, ttlSeconds: 60 });

        expect(await adapter.get('key')).toBe('value');
        const ttl = await adapter.ttl('key');
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });
    });

    describe('ifExists (XX)', () => {
      it('should not set when key does not exist', async () => {
        await adapter.set('key', 'value', { ifExists: true });
        expect(await adapter.get('key')).toBeNull();
      });

      it('should overwrite existing key', async () => {
        await adapter.set('key', 'original');
        await adapter.set('key', 'updated', { ifExists: true });
        expect(await adapter.get('key')).toBe('updated');
      });

      it('should not set when existing key is expired', async () => {
        await adapter.set('key', 'expired', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        await adapter.set('key', 'new-value', { ifExists: true });
        expect(await adapter.get('key')).toBeNull();
      });

      it('should work with TTL option', async () => {
        await adapter.set('key', 'original');
        await adapter.set('key', 'updated', { ifExists: true, ttlSeconds: 60 });

        expect(await adapter.get('key')).toBe('updated');
        const ttl = await adapter.ttl('key');
        expect(ttl).toBeGreaterThan(0);
      });
    });

    describe('combined with mset', () => {
      it('should respect ifNotExists in batch operations', async () => {
        await adapter.set('existing', 'original');

        await adapter.mset([
          { key: 'existing', value: 'new', options: { ifNotExists: true } },
          { key: 'new-key', value: 'value', options: { ifNotExists: true } },
        ]);

        expect(await adapter.get('existing')).toBe('original');
        expect(await adapter.get('new-key')).toBe('value');
      });

      it('should respect ifExists in batch operations', async () => {
        await adapter.set('existing', 'original');

        await adapter.mset([
          { key: 'existing', value: 'updated', options: { ifExists: true } },
          { key: 'new-key', value: 'value', options: { ifExists: true } },
        ]);

        expect(await adapter.get('existing')).toBe('updated');
        expect(await adapter.get('new-key')).toBeNull();
      });
    });
  });

  describe('Pub/Sub Advanced', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('multiple subscribers', () => {
      it('should deliver messages to all subscribers', async () => {
        const received1: string[] = [];
        const received2: string[] = [];
        const received3: string[] = [];

        const unsub1 = await adapter.subscribe('channel', (m) => received1.push(m));
        const unsub2 = await adapter.subscribe('channel', (m) => received2.push(m));
        const unsub3 = await adapter.subscribe('channel', (m) => received3.push(m));

        await adapter.publish('channel', 'test-message');

        expect(received1).toEqual(['test-message']);
        expect(received2).toEqual(['test-message']);
        expect(received3).toEqual(['test-message']);

        await unsub1();
        await unsub2();
        await unsub3();
      });

      it('should handle many subscribers (stress test)', async () => {
        const subscribers: Array<() => Promise<void>> = [];
        const counters: number[] = [];

        // Create 100 subscribers
        for (let i = 0; i < 100; i++) {
          counters[i] = 0;
          const idx = i;
          const unsub = await adapter.subscribe('stress-channel', () => {
            counters[idx]++;
          });
          subscribers.push(unsub);
        }

        // Publish 10 messages
        for (let j = 0; j < 10; j++) {
          await adapter.publish('stress-channel', `message-${j}`);
        }

        // Each subscriber should have received all messages
        for (let i = 0; i < 100; i++) {
          expect(counters[i]).toBe(10);
        }

        // Cleanup
        await Promise.all(subscribers.map((unsub) => unsub()));
      });
    });

    describe('handler behavior', () => {
      it('should call all handlers sequentially', async () => {
        const callOrder: number[] = [];

        const unsub1 = await adapter.subscribe('channel', () => {
          callOrder.push(1);
        });
        const unsub2 = await adapter.subscribe('channel', () => {
          callOrder.push(2);
        });
        const unsub3 = await adapter.subscribe('channel', () => {
          callOrder.push(3);
        });

        await adapter.publish('channel', 'message');

        expect(callOrder).toEqual([1, 2, 3]);

        await unsub1();
        await unsub2();
        await unsub3();
      });

      it('should support async handlers', async () => {
        const received: string[] = [];

        const unsub = await adapter.subscribe('channel', async (m) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          received.push(m);
        });

        await adapter.publish('channel', 'async-message');

        // Wait for async handler to complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(received).toEqual(['async-message']);

        await unsub();
      });
    });

    describe('unsubscribe edge cases', () => {
      it('should handle double unsubscribe gracefully', async () => {
        const received: string[] = [];
        const unsub = await adapter.subscribe('channel', (m) => received.push(m));

        await unsub();
        await unsub(); // Should not throw

        await adapter.publish('channel', 'message');
        expect(received).toEqual([]);
      });

      it('should handle unsubscribe during message delivery', async () => {
        const received: string[] = [];
        let unsubFn: (() => Promise<void>) | null = null;

        unsubFn = await adapter.subscribe('channel', async (m) => {
          received.push(m);
          if (m === 'trigger') {
            await unsubFn!();
          }
        });

        await adapter.publish('channel', 'trigger');
        await adapter.publish('channel', 'after');

        // Should only receive the trigger message
        expect(received).toEqual(['trigger']);
      });
    });

    describe('channel isolation', () => {
      it('should isolate messages between channels', async () => {
        const channel1Messages: string[] = [];
        const channel2Messages: string[] = [];

        const unsub1 = await adapter.subscribe('channel-1', (m) => channel1Messages.push(m));
        const unsub2 = await adapter.subscribe('channel-2', (m) => channel2Messages.push(m));

        await adapter.publish('channel-1', 'msg-1');
        await adapter.publish('channel-2', 'msg-2');
        await adapter.publish('channel-1', 'msg-3');

        expect(channel1Messages).toEqual(['msg-1', 'msg-3']);
        expect(channel2Messages).toEqual(['msg-2']);

        await unsub1();
        await unsub2();
      });
    });

    describe('message content', () => {
      it('should handle JSON messages', async () => {
        const received: string[] = [];
        const unsub = await adapter.subscribe('json-channel', (m) => received.push(m));

        const jsonMessage = JSON.stringify({ type: 'event', data: { id: 123 } });
        await adapter.publish('json-channel', jsonMessage);

        expect(received[0]).toBe(jsonMessage);
        expect(JSON.parse(received[0])).toEqual({ type: 'event', data: { id: 123 } });

        await unsub();
      });

      it('should handle empty string messages', async () => {
        const received: string[] = [];
        const unsub = await adapter.subscribe('channel', (m) => received.push(m));

        await adapter.publish('channel', '');

        expect(received).toEqual(['']);

        await unsub();
      });

      it('should handle very long messages', async () => {
        const received: string[] = [];
        const unsub = await adapter.subscribe('channel', (m) => received.push(m));

        const longMessage = 'x'.repeat(100000);
        await adapter.publish('channel', longMessage);

        expect(received[0]).toBe(longMessage);
        expect(received[0].length).toBe(100000);

        await unsub();
      });
    });
  });

  describe('TTL Edge Cases', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('expiration timing', () => {
      it('should expire key at exact TTL boundary', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });

        // Should exist before expiration
        expect(await adapter.get('key')).toBe('value');

        // Wait for expiration
        await new Promise((resolve) => setTimeout(resolve, 1100));

        expect(await adapter.get('key')).toBeNull();
      });

      it('should handle very short TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });

        // Immediate check should still find it
        expect(await adapter.get('key')).toBe('value');
      });
    });

    describe('TTL operations on expired keys', () => {
      it('should return null for TTL of expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        expect(await adapter.ttl('key')).toBeNull();
      });

      it('should return false for expire on expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        expect(await adapter.expire('key', 60)).toBe(false);
      });

      it('should return false for exists on expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        expect(await adapter.exists('key')).toBe(false);
      });

      it('should return false for delete on expired key', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1100));

        expect(await adapter.delete('key')).toBe(false);
      });
    });

    describe('TTL modification', () => {
      it('should extend TTL with expire()', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 1 });

        // Extend TTL
        expect(await adapter.expire('key', 60)).toBe(true);

        // Wait past original TTL
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Should still exist
        expect(await adapter.get('key')).toBe('value');
      });

      it('should reset TTL when overwriting with set()', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 5 });
        await adapter.set('key', 'new-value', { ttlSeconds: 60 });

        const ttl = await adapter.ttl('key');
        expect(ttl).toBeGreaterThan(50);
      });

      it('should remove TTL when overwriting without TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 5 });
        await adapter.set('key', 'new-value');

        expect(await adapter.ttl('key')).toBe(-1);
      });
    });

    describe('TTL with no expiration', () => {
      it('should return -1 for key without TTL', async () => {
        await adapter.set('key', 'value');
        expect(await adapter.ttl('key')).toBe(-1);
      });
    });

    describe('TTL validation', () => {
      it('should throw for negative TTL in set', async () => {
        await expect(adapter.set('key', 'value', { ttlSeconds: -1 })).rejects.toThrow(StorageTTLError);
      });

      it('should throw for zero TTL in set', async () => {
        await expect(adapter.set('key', 'value', { ttlSeconds: 0 })).rejects.toThrow(StorageTTLError);
      });

      it('should throw for negative TTL in expire', async () => {
        await adapter.set('key', 'value');
        await expect(adapter.expire('key', -1)).rejects.toThrow(StorageTTLError);
      });

      it('should throw for non-integer TTL', async () => {
        await expect(adapter.set('key', 'value', { ttlSeconds: 1.5 })).rejects.toThrow(StorageTTLError);
      });
    });
  });

  describe('LRU Eviction Advanced', () => {
    describe('eviction order', () => {
      it('should evict in order of least recent access', async () => {
        const adapter = new MemoryStorageAdapter({ maxEntries: 5, enableSweeper: false });
        await adapter.connect();

        // Add 5 entries
        for (let i = 1; i <= 5; i++) {
          await adapter.set(`key${i}`, `value${i}`);
        }

        // Access keys in specific order: 1, 3, 5 (making 2, 4 least recently used)
        await adapter.get('key1');
        await adapter.get('key3');
        await adapter.get('key5');

        // Add 2 more entries, should evict key2 and key4
        await adapter.set('key6', 'value6');
        await adapter.set('key7', 'value7');

        expect(await adapter.get('key1')).toBe('value1');
        expect(await adapter.get('key2')).toBeNull(); // Evicted
        expect(await adapter.get('key3')).toBe('value3');
        expect(await adapter.get('key4')).toBeNull(); // Evicted
        expect(await adapter.get('key5')).toBe('value5');
        expect(await adapter.get('key6')).toBe('value6');
        expect(await adapter.get('key7')).toBe('value7');

        await adapter.disconnect();
      });

      it('should update access order on set() for existing key', async () => {
        const adapter = new MemoryStorageAdapter({ maxEntries: 3, enableSweeper: false });
        await adapter.connect();

        await adapter.set('key1', 'value1');
        await adapter.set('key2', 'value2');
        await adapter.set('key3', 'value3');

        // Update key1 (moves it to most recent)
        await adapter.set('key1', 'updated');

        // Add new key, should evict key2 (now oldest)
        await adapter.set('key4', 'value4');

        expect(await adapter.get('key1')).toBe('updated');
        expect(await adapter.get('key2')).toBeNull(); // Evicted
        expect(await adapter.get('key3')).toBe('value3');
        expect(await adapter.get('key4')).toBe('value4');

        await adapter.disconnect();
      });
    });

    describe('eviction with TTL entries', () => {
      it('should evict TTL entries normally', async () => {
        const adapter = new MemoryStorageAdapter({ maxEntries: 2, enableSweeper: false });
        await adapter.connect();

        await adapter.set('key1', 'value1', { ttlSeconds: 60 });
        await adapter.set('key2', 'value2');
        await adapter.set('key3', 'value3'); // Evicts key1

        expect(await adapter.get('key1')).toBeNull();
        expect(await adapter.get('key2')).toBe('value2');
        expect(await adapter.get('key3')).toBe('value3');

        await adapter.disconnect();
      });
    });

    describe('unlimited entries', () => {
      it('should not evict when maxEntries is 0 (unlimited)', async () => {
        const adapter = new MemoryStorageAdapter({ maxEntries: 0, enableSweeper: false });
        await adapter.connect();

        // Add many entries
        for (let i = 0; i < 1000; i++) {
          await adapter.set(`key${i}`, `value${i}`);
        }

        // All should exist
        expect(await adapter.get('key0')).toBe('value0');
        expect(await adapter.get('key999')).toBe('value999');
        expect(await adapter.count()).toBe(1000);

        await adapter.disconnect();
      });
    });
  });

  describe('Concurrent Operations', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it('should handle concurrent set operations', async () => {
      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(adapter.set(`key${i}`, `value${i}`));
      }

      await Promise.all(operations);

      expect(await adapter.count()).toBe(100);
      expect(await adapter.get('key50')).toBe('value50');
    });

    it('should handle concurrent get/set operations', async () => {
      // Pre-populate
      for (let i = 0; i < 50; i++) {
        await adapter.set(`key${i}`, `value${i}`);
      }

      const operations = [];

      // Concurrent gets
      for (let i = 0; i < 50; i++) {
        operations.push(adapter.get(`key${i}`));
      }

      // Concurrent sets
      for (let i = 50; i < 100; i++) {
        operations.push(adapter.set(`key${i}`, `value${i}`));
      }

      const results = await Promise.all(operations);

      // First 50 should be get results
      expect(results[0]).toBe('value0');
      expect(results[49]).toBe('value49');

      // All 100 keys should exist
      expect(await adapter.count()).toBe(100);
    });

    it('should handle concurrent increment operations', async () => {
      await adapter.set('counter', '0');

      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(adapter.incr('counter'));
      }

      await Promise.all(operations);

      expect(await adapter.get('counter')).toBe('100');
    });

    it('should handle concurrent mget/mset', async () => {
      const msetOp = adapter.mset(
        Array.from({ length: 50 }, (_, i) => ({
          key: `batch1:${i}`,
          value: `value${i}`,
        })),
      );

      const msetOp2 = adapter.mset(
        Array.from({ length: 50 }, (_, i) => ({
          key: `batch2:${i}`,
          value: `value${i}`,
        })),
      );

      await Promise.all([msetOp, msetOp2]);

      const keys1 = await adapter.mget(Array.from({ length: 50 }, (_, i) => `batch1:${i}`));
      const keys2 = await adapter.mget(Array.from({ length: 50 }, (_, i) => `batch2:${i}`));

      expect(keys1.filter((v) => v !== null).length).toBe(50);
      expect(keys2.filter((v) => v !== null).length).toBe(50);
    });
  });

  describe('Namespace Advanced', () => {
    let adapter: MemoryStorageAdapter;
    let root: NamespacedStorage;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
      root = createRootStorage(adapter);
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('deeply nested namespaces', () => {
      it('should handle 10 levels of nesting', async () => {
        let ns = root;
        for (let i = 1; i <= 10; i++) {
          ns = ns.namespace(`level${i}`);
        }

        await ns.set('deep-key', 'deep-value');

        expect(ns.prefix).toBe('level1:level2:level3:level4:level5:level6:level7:level8:level9:level10:');
        expect(
          await adapter.get('level1:level2:level3:level4:level5:level6:level7:level8:level9:level10:deep-key'),
        ).toBe('deep-value');
      });

      it('should maintain root reference through deep nesting', async () => {
        let ns = root;
        for (let i = 1; i <= 5; i++) {
          ns = ns.namespace(`level${i}`, `id${i}`);
        }

        expect(ns.root).toBe(adapter);
      });
    });

    describe('special characters in names', () => {
      it('should handle names with colons', async () => {
        const ns = root.namespace('name:with:colons');
        await ns.set('key', 'value');

        expect(await adapter.get('name:with:colons:key')).toBe('value');
      });

      it('should handle names with spaces', async () => {
        const ns = root.namespace('name with spaces');
        await ns.set('key', 'value');

        expect(await adapter.get('name with spaces:key')).toBe('value');
      });

      it('should handle unicode names', async () => {
        const ns = root.namespace('名前');
        await ns.set('キー', '値');

        expect(await adapter.get('名前:キー')).toBe('値');
      });

      it('should handle emoji names', async () => {
        const ns = root.namespace('🎉');
        await ns.set('🔑', '💎');

        expect(await adapter.get('🎉:🔑')).toBe('💎');
      });
    });

    describe('namespace isolation', () => {
      it('should isolate data between namespaces', async () => {
        const ns1 = root.namespace('ns1');
        const ns2 = root.namespace('ns2');

        await ns1.set('shared-key', 'value1');
        await ns2.set('shared-key', 'value2');

        expect(await ns1.get('shared-key')).toBe('value1');
        expect(await ns2.get('shared-key')).toBe('value2');
      });

      it('should list only keys within namespace', async () => {
        const ns1 = root.namespace('ns1');
        const ns2 = root.namespace('ns2');

        await ns1.set('key1', 'value1');
        await ns1.set('key2', 'value2');
        await ns2.set('key3', 'value3');

        const keys1 = await ns1.keys();
        const keys2 = await ns2.keys();

        expect(keys1.sort()).toEqual(['key1', 'key2']);
        expect(keys2).toEqual(['key3']);
      });
    });

    describe('namespace with IDs', () => {
      it('should isolate data between same namespace with different IDs', async () => {
        const session1 = root.namespace('session', 'user-123');
        const session2 = root.namespace('session', 'user-456');

        await session1.set('token', 'token123');
        await session2.set('token', 'token456');

        expect(await session1.get('token')).toBe('token123');
        expect(await session2.get('token')).toBe('token456');
      });

      it('should count keys correctly per namespace', async () => {
        const session1 = root.namespace('session', 'user-123');
        const session2 = root.namespace('session', 'user-456');

        await session1.set('key1', 'value1');
        await session1.set('key2', 'value2');
        await session2.set('key3', 'value3');

        expect(await session1.count()).toBe(2);
        expect(await session2.count()).toBe(1);
      });
    });

    describe('namespace batch operations', () => {
      it('should handle mdelete correctly', async () => {
        const ns = root.namespace('batch');

        await ns.mset([
          { key: 'key1', value: 'value1' },
          { key: 'key2', value: 'value2' },
          { key: 'key3', value: 'value3' },
        ]);

        const deleted = await ns.mdelete(['key1', 'key3', 'nonexistent']);

        expect(deleted).toBe(2);
        expect(await ns.get('key1')).toBeNull();
        expect(await ns.get('key2')).toBe('value2');
        expect(await ns.get('key3')).toBeNull();
      });
    });
  });

  describe('Pattern Matching Edge Cases', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('complex patterns', () => {
      beforeEach(async () => {
        await adapter.mset([
          { key: 'user:123:profile', value: 'data' },
          { key: 'user:456:profile', value: 'data' },
          { key: 'user:123:settings', value: 'data' },
          { key: 'session:abc', value: 'data' },
          { key: 'session:def', value: 'data' },
          { key: 'cache:user:123', value: 'data' },
        ]);
      });

      it('should match with multiple wildcards', async () => {
        const keys = await adapter.keys('user:*:*');
        expect(keys.sort()).toEqual(['user:123:profile', 'user:123:settings', 'user:456:profile']);
      });

      it('should match with question mark wildcard', async () => {
        const keys = await adapter.keys('session:???');
        expect(keys.sort()).toEqual(['session:abc', 'session:def']);
      });

      it('should match with mixed wildcards', async () => {
        // *:??? matches anything ending with :XXX where XXX is exactly 3 chars
        // This includes session:abc, session:def, AND cache:user:123 (where 123 is 3 chars)
        const keys = await adapter.keys('*:???');
        expect(keys.sort()).toEqual(['cache:user:123', 'session:abc', 'session:def']);
      });
    });

    describe('empty and edge patterns', () => {
      it('should match all keys with * pattern', async () => {
        await adapter.set('key1', 'value1');
        await adapter.set('key2', 'value2');

        const keys = await adapter.keys('*');
        expect(keys.length).toBe(2);
      });

      it('should return empty array for non-matching pattern', async () => {
        await adapter.set('key1', 'value1');

        const keys = await adapter.keys('nonexistent:*');
        expect(keys).toEqual([]);
      });

      it('should handle literal match (no wildcards)', async () => {
        await adapter.set('exact-key', 'value');
        await adapter.set('exact-key-2', 'value');

        const keys = await adapter.keys('exact-key');
        expect(keys).toEqual(['exact-key']);
      });
    });

    describe('special characters in keys', () => {
      it('should handle keys with dots', async () => {
        await adapter.set('file.txt', 'content');
        await adapter.set('file.json', 'content');

        const keys = await adapter.keys('file.*');
        expect(keys.sort()).toEqual(['file.json', 'file.txt']);
      });

      it('should handle keys with brackets', async () => {
        await adapter.set('array[0]', 'value');
        await adapter.set('array[1]', 'value');

        const count = await adapter.count('array*');
        expect(count).toBe(2);
      });
    });
  });

  describe('Error Scenarios', () => {
    describe('disconnected adapter', () => {
      it('should throw StorageNotConnectedError for all operations', async () => {
        const adapter = new MemoryStorageAdapter();

        await expect(adapter.get('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.set('key', 'value')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.delete('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.exists('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.mget(['key'])).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.mset([{ key: 'k', value: 'v' }])).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.mdelete(['key'])).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.keys()).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.count()).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.expire('key', 60)).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.ttl('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.incr('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.decr('key')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.incrBy('key', 1)).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.publish('channel', 'msg')).rejects.toThrow(StorageNotConnectedError);
        await expect(adapter.subscribe('channel', () => {})).rejects.toThrow(StorageNotConnectedError);
      });
    });

    describe('operation after disconnect', () => {
      it('should throw after disconnect', async () => {
        const adapter = new MemoryStorageAdapter();
        await adapter.connect();
        await adapter.set('key', 'value');

        await adapter.disconnect();

        await expect(adapter.get('key')).rejects.toThrow(StorageNotConnectedError);
      });

      it('should allow reconnection', async () => {
        const adapter = new MemoryStorageAdapter();
        await adapter.connect();
        await adapter.set('key', 'value');
        await adapter.disconnect();

        await adapter.connect();

        // Data should be cleared after disconnect/reconnect
        expect(await adapter.get('key')).toBeNull();
        await adapter.disconnect();
      });
    });

    describe('increment/decrement errors', () => {
      let adapter: MemoryStorageAdapter;

      beforeEach(async () => {
        adapter = new MemoryStorageAdapter({ enableSweeper: false });
        await adapter.connect();
      });

      afterEach(async () => {
        await adapter.disconnect();
      });

      it('should throw for incr on non-numeric value', async () => {
        await adapter.set('key', 'not-a-number');
        await expect(adapter.incr('key')).rejects.toThrow(StorageOperationError);
      });

      it('should throw for decr on non-numeric value', async () => {
        await adapter.set('key', 'abc');
        await expect(adapter.decr('key')).rejects.toThrow(StorageOperationError);
      });

      it('should throw for incrBy on non-numeric value', async () => {
        await adapter.set('key', '{}');
        await expect(adapter.incrBy('key', 5)).rejects.toThrow(StorageOperationError);
      });

      it('should truncate float values to integer', async () => {
        // parseInt('3.14', 10) returns 3, so floats are truncated
        await adapter.set('key', '3.14');
        const result = await adapter.incr('key');
        expect(result).toBe(4); // 3 (truncated) + 1
      });
    });
  });

  describe('Large Values', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter({ enableSweeper: false });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it('should handle 1MB value', async () => {
      const largeValue = 'x'.repeat(1024 * 1024); // 1MB
      await adapter.set('large-key', largeValue);

      const retrieved = await adapter.get('large-key');
      expect(retrieved?.length).toBe(1024 * 1024);
    });

    it('should handle complex JSON with many keys', async () => {
      const complexObject: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        complexObject[`key${i}`] = `value${i}`;
      }

      const json = JSON.stringify(complexObject);
      await adapter.set('complex-json', json);

      const retrieved = await adapter.get('complex-json');
      const parsed = JSON.parse(retrieved!);
      expect(Object.keys(parsed).length).toBe(10000);
    });
  });

  describe('Sweeper Behavior', () => {
    it('should clean up expired keys with sweeper enabled', async () => {
      const adapter = new MemoryStorageAdapter({
        enableSweeper: true,
        sweepIntervalSeconds: 1,
      });
      await adapter.connect();

      // Add entries with short TTL
      await adapter.set('temp1', 'value1', { ttlSeconds: 1 });
      await adapter.set('temp2', 'value2', { ttlSeconds: 1 });
      await adapter.set('permanent', 'value3');

      // Wait for expiration and sweeper
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Check stats - expired entries should be cleaned up
      const stats = adapter.getStats();
      expect(stats.size).toBe(1); // Only permanent key remains

      await adapter.disconnect();
    });
  });
});
