/**
 * FileSystemStorageAdapter Tests
 */

import { FileSystemStorageAdapter } from '../filesystem';
import { StorageNotConnectedError } from '../../errors';
import { rm, mkdtemp } from '../../../fs';
import * as path from 'path';
import * as os from 'os';

describe('FileSystemStorageAdapter', () => {
  let adapter: FileSystemStorageAdapter;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await mkdtemp(path.join(os.tmpdir(), 'fs-adapter-test-'));
    adapter = new FileSystemStorageAdapter({ baseDir: testDir });
    await adapter.connect();
  });

  afterEach(async () => {
    // Clean up
    try {
      await adapter.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Connection Lifecycle', () => {
    it('should connect successfully', async () => {
      const newAdapter = new FileSystemStorageAdapter({ baseDir: testDir });
      await newAdapter.connect();
      expect(await newAdapter.ping()).toBe(true);
      await newAdapter.disconnect();
    });

    it('should handle double connect', async () => {
      await adapter.connect(); // Already connected in beforeEach
      expect(await adapter.ping()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await adapter.disconnect();
      expect(await adapter.ping()).toBe(false);
    });

    it('should handle double disconnect', async () => {
      await adapter.disconnect();
      await adapter.disconnect();
      expect(await adapter.ping()).toBe(false);
    });

    it('should throw when not connected', async () => {
      const newAdapter = new FileSystemStorageAdapter({ baseDir: testDir });
      await expect(newAdapter.get('key')).rejects.toThrow(StorageNotConnectedError);
    });
  });

  describe('Core Operations', () => {
    it('should set and get a value', async () => {
      await adapter.set('key1', 'value1');
      const result = await adapter.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should overwrite existing value', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key1', 'value2');
      const result = await adapter.get('key1');
      expect(result).toBe('value2');
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'user:123:profile:settings';
      await adapter.set(specialKey, 'test-value');
      const result = await adapter.get(specialKey);
      expect(result).toBe('test-value');
    });

    it('should handle keys with spaces', async () => {
      const keyWithSpaces = 'my key with spaces';
      await adapter.set(keyWithSpaces, 'value');
      const result = await adapter.get(keyWithSpaces);
      expect(result).toBe('value');
    });

    it('should delete a key', async () => {
      await adapter.set('key1', 'value1');
      const deleted = await adapter.delete('key1');
      expect(deleted).toBe(true);
      const result = await adapter.get('key1');
      expect(result).toBeNull();
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await adapter.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      await adapter.set('key1', 'value1');
      expect(await adapter.exists('key1')).toBe(true);
      expect(await adapter.exists('nonexistent')).toBe(false);
    });
  });

  describe('Conditional Operations', () => {
    it('should respect ifNotExists flag', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key1', 'value2', { ifNotExists: true });
      const result = await adapter.get('key1');
      expect(result).toBe('value1'); // Original value preserved
    });

    it('should set when key does not exist with ifNotExists', async () => {
      await adapter.set('newkey', 'newvalue', { ifNotExists: true });
      const result = await adapter.get('newkey');
      expect(result).toBe('newvalue');
    });

    it('should respect ifExists flag', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key1', 'value2', { ifExists: true });
      const result = await adapter.get('key1');
      expect(result).toBe('value2');
    });

    it('should not set when key does not exist with ifExists', async () => {
      await adapter.set('nonexistent', 'value', { ifExists: true });
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('TTL Operations', () => {
    it('should expire key after TTL', async () => {
      await adapter.set('ttl-key', 'value', { ttlSeconds: 1 });

      // Should exist immediately
      expect(await adapter.get('ttl-key')).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      expect(await adapter.get('ttl-key')).toBeNull();
    });

    it('should update TTL with expire()', async () => {
      await adapter.set('key1', 'value1');
      const result = await adapter.expire('key1', 60);
      expect(result).toBe(true);

      const ttl = await adapter.ttl('key1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should return -1 for key without TTL', async () => {
      await adapter.set('no-ttl', 'value');
      const ttl = await adapter.ttl('no-ttl');
      expect(ttl).toBe(-1);
    });

    it('should return null for TTL of non-existent key', async () => {
      const ttl = await adapter.ttl('nonexistent');
      expect(ttl).toBeNull();
    });

    it('should not expire non-existent key', async () => {
      const result = await adapter.expire('nonexistent', 60);
      expect(result).toBe(false);
    });
  });

  describe('Key Enumeration', () => {
    beforeEach(async () => {
      await adapter.set('user:1', 'alice');
      await adapter.set('user:2', 'bob');
      await adapter.set('admin:1', 'admin');
      await adapter.set('config', 'settings');
    });

    it('should list all keys', async () => {
      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['admin:1', 'config', 'user:1', 'user:2'].sort());
    });

    it('should list keys matching pattern', async () => {
      const keys = await adapter.keys('user:*');
      expect(keys.sort()).toEqual(['user:1', 'user:2'].sort());
    });

    it('should count all keys', async () => {
      const count = await adapter.count();
      expect(count).toBe(4);
    });

    it('should count keys matching pattern', async () => {
      const count = await adapter.count('user:*');
      expect(count).toBe(2);
    });

    it('should return empty array for no matches', async () => {
      const keys = await adapter.keys('nonexistent:*');
      expect(keys).toEqual([]);
    });
  });

  describe('Atomic Operations', () => {
    it('should increment a value', async () => {
      await adapter.set('counter', '5');
      const result = await adapter.incr('counter');
      expect(result).toBe(6);
    });

    it('should create key with value 1 when incrementing non-existent key', async () => {
      const result = await adapter.incr('new-counter');
      expect(result).toBe(1);
    });

    it('should decrement a value', async () => {
      await adapter.set('counter', '5');
      const result = await adapter.decr('counter');
      expect(result).toBe(4);
    });

    it('should increment by specific amount', async () => {
      await adapter.set('counter', '10');
      const result = await adapter.incrBy('counter', 5);
      expect(result).toBe(15);
    });

    it('should throw when incrementing non-integer value', async () => {
      await adapter.set('not-a-number', 'hello');
      await expect(adapter.incr('not-a-number')).rejects.toThrow('not an integer');
    });
  });

  describe('Batch Operations', () => {
    it('should get multiple values', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');

      const results = await adapter.mget(['key1', 'key2', 'nonexistent']);
      expect(results).toEqual(['value1', 'value2', null]);
    });

    it('should set multiple values', async () => {
      await adapter.mset([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);

      expect(await adapter.get('key1')).toBe('value1');
      expect(await adapter.get('key2')).toBe('value2');
    });

    it('should delete multiple keys', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');
      await adapter.set('key3', 'value3');

      const deleted = await adapter.mdelete(['key1', 'key2', 'nonexistent']);
      expect(deleted).toBe(2);

      expect(await adapter.get('key1')).toBeNull();
      expect(await adapter.get('key2')).toBeNull();
      expect(await adapter.get('key3')).toBe('value3');
    });
  });

  describe('Pub/Sub', () => {
    it('should not support pub/sub', () => {
      expect(adapter.supportsPubSub()).toBe(false);
    });

    it('should throw on publish', async () => {
      await expect(adapter.publish('channel', 'message')).rejects.toThrow();
    });

    it('should throw on subscribe', async () => {
      await expect(adapter.subscribe('channel', () => {})).rejects.toThrow();
    });
  });

  describe('File Encoding', () => {
    it('should handle unicode characters in values', async () => {
      const unicodeValue = 'Hello 世界 🌍 مرحبا';
      await adapter.set('unicode', unicodeValue);
      const result = await adapter.get('unicode');
      expect(result).toBe(unicodeValue);
    });

    it('should handle JSON-like values', async () => {
      const jsonValue = JSON.stringify({ name: 'test', nested: { array: [1, 2, 3] } });
      await adapter.set('json', jsonValue);
      const result = await adapter.get('json');
      expect(result).toBe(jsonValue);
    });
  });

  describe('Custom Options', () => {
    it('should use custom file extension', async () => {
      const customAdapter = new FileSystemStorageAdapter({
        baseDir: testDir,
        extension: '.dat',
      });
      await customAdapter.connect();

      await customAdapter.set('test', 'value');
      const result = await customAdapter.get('test');
      expect(result).toBe('value');

      await customAdapter.disconnect();
    });
  });
});
