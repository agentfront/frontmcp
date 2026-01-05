/**
 * Namespaced Storage Tests
 */
import { MemoryStorageAdapter } from '../adapters/memory';
import {
  NamespacedStorageImpl,
  buildPrefix,
  createRootStorage,
  createNamespacedStorage,
  NAMESPACE_SEPARATOR,
} from '../namespace';
import type { NamespacedStorage } from '../types';

describe('Namespaced Storage', () => {
  let adapter: MemoryStorageAdapter;
  let storage: NamespacedStorage;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter({ enableSweeper: false });
    await adapter.connect();
    storage = createRootStorage(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('buildPrefix', () => {
    it('should build prefix with name only', () => {
      expect(buildPrefix('session')).toBe('session:');
    });

    it('should build prefix with name and id', () => {
      expect(buildPrefix('session', 'abc123')).toBe('session:abc123:');
    });

    it('should handle empty id', () => {
      expect(buildPrefix('session', '')).toBe('session:');
    });
  });

  describe('createRootStorage', () => {
    it('should create storage with empty prefix', () => {
      const root = createRootStorage(adapter);
      expect(root.prefix).toBe('');
    });

    it('should have adapter as root', () => {
      const root = createRootStorage(adapter);
      expect(root.root).toBe(adapter);
    });
  });

  describe('createNamespacedStorage', () => {
    it('should create storage with given prefix', () => {
      const ns = createNamespacedStorage(adapter, 'app');
      expect(ns.prefix).toBe('app:');
    });

    it('should normalize prefix without trailing separator', () => {
      const ns = createNamespacedStorage(adapter, 'app');
      expect(ns.prefix).toBe('app:');
    });

    it('should not double separator if prefix has one', () => {
      const ns = createNamespacedStorage(adapter, 'app:');
      expect(ns.prefix).toBe('app:');
    });

    it('should handle empty prefix', () => {
      const ns = createNamespacedStorage(adapter, '');
      expect(ns.prefix).toBe('');
    });
  });

  describe('namespace chaining', () => {
    it('should create child namespace', () => {
      const session = storage.namespace('session');
      expect(session.prefix).toBe('session:');
    });

    it('should create child namespace with id', () => {
      const session = storage.namespace('session', 'abc123');
      expect(session.prefix).toBe('session:abc123:');
    });

    it('should chain multiple namespaces', () => {
      const session = storage.namespace('session', 'sess1');
      const user = session.namespace('user', 'user1');
      expect(user.prefix).toBe('session:sess1:user:user1:');
    });

    it('should maintain root reference through chain', () => {
      const session = storage.namespace('session', 'sess1');
      const user = session.namespace('user', 'user1');
      expect(user.root).toBe(adapter);
    });
  });

  describe('key prefixing', () => {
    it('should prefix keys on set', async () => {
      const session = storage.namespace('session', 'abc');
      await session.set('key', 'value');

      // Check actual key in adapter
      expect(await adapter.get('session:abc:key')).toBe('value');
    });

    it('should prefix keys on get', async () => {
      await adapter.set('session:abc:key', 'value');

      const session = storage.namespace('session', 'abc');
      expect(await session.get('key')).toBe('value');
    });

    it('should prefix keys on delete', async () => {
      await adapter.set('session:abc:key', 'value');

      const session = storage.namespace('session', 'abc');
      expect(await session.delete('key')).toBe(true);
      expect(await adapter.get('session:abc:key')).toBeNull();
    });

    it('should prefix keys on exists', async () => {
      await adapter.set('session:abc:key', 'value');

      const session = storage.namespace('session', 'abc');
      expect(await session.exists('key')).toBe(true);
      expect(await session.exists('other')).toBe(false);
    });
  });

  describe('batch operations with prefixing', () => {
    it('should prefix keys on mget', async () => {
      await adapter.set('ns:key1', 'value1');
      await adapter.set('ns:key2', 'value2');

      const ns = storage.namespace('ns');
      const values = await ns.mget(['key1', 'key2', 'key3']);
      expect(values).toEqual(['value1', 'value2', null]);
    });

    it('should prefix keys on mset', async () => {
      const ns = storage.namespace('ns');
      await ns.mset([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);

      expect(await adapter.get('ns:key1')).toBe('value1');
      expect(await adapter.get('ns:key2')).toBe('value2');
    });

    it('should prefix keys on mdelete', async () => {
      await adapter.set('ns:key1', 'value1');
      await adapter.set('ns:key2', 'value2');
      await adapter.set('other:key', 'value');

      const ns = storage.namespace('ns');
      const deleted = await ns.mdelete(['key1', 'key2']);
      expect(deleted).toBe(2);
      expect(await adapter.get('other:key')).toBe('value');
    });
  });

  describe('TTL operations with prefixing', () => {
    it('should prefix key on expire', async () => {
      await adapter.set('ns:key', 'value');

      const ns = storage.namespace('ns');
      expect(await ns.expire('key', 60)).toBe(true);
      expect(await adapter.ttl('ns:key')).toBeGreaterThan(0);
    });

    it('should prefix key on ttl', async () => {
      await adapter.set('ns:key', 'value', { ttlSeconds: 60 });

      const ns = storage.namespace('ns');
      const ttl = await ns.ttl('key');
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('key enumeration with prefixing', () => {
    beforeEach(async () => {
      // Set up test data in adapter
      await adapter.set('ns:key1', 'value1');
      await adapter.set('ns:key2', 'value2');
      await adapter.set('ns:sub:key3', 'value3');
      await adapter.set('other:key', 'value');
    });

    it('should list keys with prefix stripped', async () => {
      const ns = storage.namespace('ns');
      const keys = await ns.keys('*');

      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('sub:key3');
      expect(keys).not.toContain('ns:key1'); // Prefix should be stripped
    });

    it('should filter with pattern within namespace', async () => {
      const ns = storage.namespace('ns');
      const keys = await ns.keys('sub:*');

      expect(keys).toHaveLength(1);
      expect(keys).toContain('sub:key3');
    });

    it('should count keys in namespace', async () => {
      const ns = storage.namespace('ns');
      expect(await ns.count('*')).toBe(3);
      expect(await ns.count('sub:*')).toBe(1);
    });
  });

  describe('atomic operations with prefixing', () => {
    it('should prefix key on incr', async () => {
      const ns = storage.namespace('ns');
      await ns.incr('counter');

      expect(await adapter.get('ns:counter')).toBe('1');
    });

    it('should prefix key on decr', async () => {
      await adapter.set('ns:counter', '10');

      const ns = storage.namespace('ns');
      expect(await ns.decr('counter')).toBe(9);
    });

    it('should prefix key on incrBy', async () => {
      const ns = storage.namespace('ns');
      await ns.incrBy('counter', 5);

      expect(await adapter.get('ns:counter')).toBe('5');
    });
  });

  describe('pub/sub with channel prefixing', () => {
    it('should prefix channel on publish', async () => {
      const ns = storage.namespace('ns');
      let receivedChannel: string | undefined;

      await adapter.subscribe('ns:events', (_, ch) => {
        receivedChannel = ch;
      });

      await ns.publish('events', 'test');
      expect(receivedChannel).toBe('ns:events');
    });

    it('should prefix channel on subscribe', async () => {
      const ns = storage.namespace('ns');
      const received: Array<{ message: string; channel: string }> = [];

      await ns.subscribe('events', (message, channel) => {
        received.push({ message, channel });
      });

      await adapter.publish('ns:events', 'test');

      expect(received).toHaveLength(1);
      expect(received[0].message).toBe('test');
      // Channel should be unprefixed in callback
      expect(received[0].channel).toBe('events');
    });

    it('should report pub/sub support', () => {
      const ns = storage.namespace('ns');
      expect(ns.supportsPubSub()).toBe(true);
    });
  });

  describe('connection lifecycle delegation', () => {
    it('should delegate connect', async () => {
      const newAdapter = new MemoryStorageAdapter({ enableSweeper: false });
      const ns = createRootStorage(newAdapter);

      await ns.connect();
      expect(await ns.ping()).toBe(true);

      await newAdapter.disconnect();
    });

    it('should delegate disconnect', async () => {
      const ns = createRootStorage(adapter);
      await ns.disconnect();
      expect(await adapter.ping()).toBe(false);
    });

    it('should delegate ping', async () => {
      const ns = createRootStorage(adapter);
      expect(await ns.ping()).toBe(true);
    });
  });

  describe('isolation between namespaces', () => {
    it('should isolate data between sibling namespaces', async () => {
      const ns1 = storage.namespace('ns1');
      const ns2 = storage.namespace('ns2');

      await ns1.set('key', 'value1');
      await ns2.set('key', 'value2');

      expect(await ns1.get('key')).toBe('value1');
      expect(await ns2.get('key')).toBe('value2');
    });

    it('should isolate data between nested namespaces', async () => {
      const parent = storage.namespace('parent');
      const child1 = parent.namespace('child1');
      const child2 = parent.namespace('child2');

      await child1.set('key', 'value1');
      await child2.set('key', 'value2');

      expect(await child1.get('key')).toBe('value1');
      expect(await child2.get('key')).toBe('value2');
      expect(await parent.get('key')).toBeNull(); // Parent doesn't have this key
    });
  });
});
