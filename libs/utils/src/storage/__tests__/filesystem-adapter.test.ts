/**
 * FileSystemStorageAdapter Tests
 */

import { FileSystemStorageAdapter } from '../adapters/filesystem';
import { StorageNotConnectedError, StorageOperationError } from '../errors';
import { rm, mkdtemp, fileExists } from '../../fs';
import * as path from 'path';
import * as os from 'os';

describe('FileSystemStorageAdapter', () => {
  let adapter: FileSystemStorageAdapter;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'fs-adapter-test-'));
    adapter = new FileSystemStorageAdapter({ baseDir: testDir });
    await adapter.connect();
  });

  afterEach(async () => {
    try {
      await adapter.disconnect();
    } catch {
      // ignore
    }
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Connection Lifecycle', () => {
    it('should connect and set connected state', async () => {
      expect(await adapter.ping()).toBe(true);
    });

    it('should be idempotent on connect', async () => {
      await adapter.connect();
      expect(await adapter.ping()).toBe(true);
    });

    it('should disconnect', async () => {
      await adapter.disconnect();
      expect(await adapter.ping()).toBe(false);
    });

    it('should be idempotent on disconnect', async () => {
      await adapter.disconnect();
      await adapter.disconnect();
      expect(await adapter.ping()).toBe(false);
    });

    it('should throw when operating while disconnected', async () => {
      await adapter.disconnect();
      await expect(adapter.get('key')).rejects.toThrow(StorageNotConnectedError);
    });
  });

  describe('Core Operations', () => {
    it('should set and get a value', async () => {
      await adapter.set('key1', 'value1');
      expect(await adapter.get('key1')).toBe('value1');
    });

    it('should return null for non-existent key', async () => {
      expect(await adapter.get('nonexistent')).toBeNull();
    });

    it('should overwrite existing value', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key1', 'value2');
      expect(await adapter.get('key1')).toBe('value2');
    });

    it('should delete a key', async () => {
      await adapter.set('key1', 'value1');
      const deleted = await adapter.delete('key1');
      expect(deleted).toBe(true);
      expect(await adapter.get('key1')).toBeNull();
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

    it('should handle keys with special characters', async () => {
      await adapter.set('user:123:profile', 'data');
      expect(await adapter.get('user:123:profile')).toBe('data');
    });

    it('should handle JSON values', async () => {
      const json = JSON.stringify({ name: 'John', age: 30 });
      await adapter.set('user', json);
      expect(await adapter.get('user')).toBe(json);
    });
  });

  describe('TTL Operations', () => {
    it('should set value with TTL', async () => {
      await adapter.set('expiring', 'value', { ttlSeconds: 60 });
      expect(await adapter.get('expiring')).toBe('value');
    });

    it('should return expired entry as null', async () => {
      await adapter.set('expiring', 'value', { ttlSeconds: 1 });

      // Manually set the entry to be already expired
      const filePath = path.join(testDir, 'expiring.json');
      const { writeFile } = await import('../../fs');
      await writeFile(filePath, JSON.stringify({ value: 'value', expiresAt: Date.now() - 1000 }));

      expect(await adapter.get('expiring')).toBeNull();
    });

    it('should report expired entry as non-existent', async () => {
      await adapter.set('expiring', 'value', { ttlSeconds: 1 });

      // Manually expire
      const filePath = path.join(testDir, 'expiring.json');
      const { writeFile } = await import('../../fs');
      await writeFile(filePath, JSON.stringify({ value: 'value', expiresAt: Date.now() - 1000 }));

      expect(await adapter.exists('expiring')).toBe(false);
    });

    it('should get TTL for key with expiration', async () => {
      await adapter.set('ttl-key', 'value', { ttlSeconds: 120 });
      const ttl = await adapter.ttl('ttl-key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);
    });

    it('should return -1 for key without TTL', async () => {
      await adapter.set('no-ttl', 'value');
      expect(await adapter.ttl('no-ttl')).toBe(-1);
    });

    it('should return null for non-existent key TTL', async () => {
      expect(await adapter.ttl('nonexistent')).toBeNull();
    });

    it('should return null for expired key TTL', async () => {
      await adapter.set('expired', 'value', { ttlSeconds: 1 });

      const filePath = path.join(testDir, 'expired.json');
      const { writeFile } = await import('../../fs');
      await writeFile(filePath, JSON.stringify({ value: 'value', expiresAt: Date.now() - 1000 }));

      expect(await adapter.ttl('expired')).toBeNull();
    });

    it('should update TTL with expire()', async () => {
      await adapter.set('key1', 'value');
      const result = await adapter.expire('key1', 300);
      expect(result).toBe(true);

      const ttl = await adapter.ttl('key1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('should return false when expire on non-existent key', async () => {
      const result = await adapter.expire('nonexistent', 300);
      expect(result).toBe(false);
    });

    it('should return false when expire on already-expired key', async () => {
      await adapter.set('expired', 'value', { ttlSeconds: 1 });

      const filePath = path.join(testDir, 'expired.json');
      const { writeFile } = await import('../../fs');
      await writeFile(filePath, JSON.stringify({ value: 'value', expiresAt: Date.now() - 1000 }));

      const result = await adapter.expire('expired', 300);
      expect(result).toBe(false);
    });
  });

  describe('Conditional Set Operations', () => {
    it('should support ifNotExists (NX)', async () => {
      await adapter.set('nx-key', 'first', { ifNotExists: true });
      expect(await adapter.get('nx-key')).toBe('first');

      await adapter.set('nx-key', 'second', { ifNotExists: true });
      expect(await adapter.get('nx-key')).toBe('first');
    });

    it('should support ifExists (XX)', async () => {
      await adapter.set('xx-key', 'value', { ifExists: true });
      expect(await adapter.get('xx-key')).toBeNull();

      await adapter.set('xx-key', 'first');
      await adapter.set('xx-key', 'second', { ifExists: true });
      expect(await adapter.get('xx-key')).toBe('second');
    });
  });

  describe('Key Enumeration', () => {
    it('should list all keys', async () => {
      await adapter.set('key1', 'v1');
      await adapter.set('key2', 'v2');
      await adapter.set('key3', 'v3');

      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['key1', 'key2', 'key3']);
    });

    it('should list keys matching pattern', async () => {
      await adapter.set('user:1', 'a');
      await adapter.set('user:2', 'b');
      await adapter.set('session:1', 'c');

      const keys = await adapter.keys('user:*');
      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });

    it('should not list expired keys', async () => {
      await adapter.set('active', 'value');
      await adapter.set('expired', 'value', { ttlSeconds: 1 });

      const filePath = path.join(testDir, 'expired.json');
      const { writeFile } = await import('../../fs');
      await writeFile(filePath, JSON.stringify({ value: 'value', expiresAt: Date.now() - 1000 }));

      const keys = await adapter.keys();
      expect(keys).toEqual(['active']);
    });

    it('should return empty array for non-existent directory', async () => {
      const badAdapter = new FileSystemStorageAdapter({
        baseDir: path.join(testDir, 'nonexistent-subdir'),
      });
      await badAdapter.connect();

      // Remove the created directory to simulate missing dir during keys()
      await rm(path.join(testDir, 'nonexistent-subdir'), { recursive: true, force: true });

      const keys = await badAdapter.keys();
      expect(keys).toEqual([]);
    });
  });

  describe('Atomic Operations', () => {
    it('should increment value', async () => {
      expect(await adapter.incr('counter')).toBe(1);
      expect(await adapter.incr('counter')).toBe(2);
    });

    it('should decrement value', async () => {
      await adapter.set('counter', '10');
      expect(await adapter.decr('counter')).toBe(9);
    });

    it('should increment by amount', async () => {
      expect(await adapter.incrBy('counter', 5)).toBe(5);
      expect(await adapter.incrBy('counter', 3)).toBe(8);
    });

    it('should throw for non-numeric value on incr', async () => {
      await adapter.set('counter', 'not-a-number');
      await expect(adapter.incr('counter')).rejects.toThrow(StorageOperationError);
    });

    it('should preserve TTL on increment', async () => {
      await adapter.set('counter', '5', { ttlSeconds: 300 });
      await adapter.incr('counter');

      const ttl = await adapter.ttl('counter');
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('Batch Operations', () => {
    it('should get multiple values', async () => {
      await adapter.set('a', '1');
      await adapter.set('b', '2');

      const results = await adapter.mget(['a', 'b', 'c']);
      expect(results).toEqual(['1', '2', null]);
    });

    it('should set multiple values', async () => {
      await adapter.mset([
        { key: 'x', value: '10' },
        { key: 'y', value: '20' },
      ]);

      expect(await adapter.get('x')).toBe('10');
      expect(await adapter.get('y')).toBe('20');
    });

    it('should delete multiple keys', async () => {
      await adapter.set('a', '1');
      await adapter.set('b', '2');
      await adapter.set('c', '3');

      const count = await adapter.mdelete(['a', 'b', 'd']);
      expect(count).toBe(2);
    });
  });

  describe('Pub/Sub', () => {
    it('should not support pub/sub', () => {
      expect(adapter.supportsPubSub()).toBe(false);
    });

    it('should throw on publish', async () => {
      await expect(adapter.publish('channel', 'msg')).rejects.toThrow();
    });

    it('should throw on subscribe', async () => {
      await expect(adapter.subscribe('channel', () => {})).rejects.toThrow();
    });
  });

  describe('Custom Options', () => {
    it('should use custom file extension', async () => {
      const customDir = await mkdtemp(path.join(os.tmpdir(), 'fs-custom-'));
      try {
        const customAdapter = new FileSystemStorageAdapter({
          baseDir: customDir,
          extension: '.dat',
        });
        await customAdapter.connect();

        await customAdapter.set('key1', 'value1');
        expect(await customAdapter.get('key1')).toBe('value1');

        // Verify file exists with custom extension
        expect(await fileExists(path.join(customDir, 'key1.dat'))).toBe(true);

        await customAdapter.disconnect();
      } finally {
        await rm(customDir, { recursive: true, force: true });
      }
    });
  });

  describe('Count', () => {
    it('should count keys', async () => {
      await adapter.set('a', '1');
      await adapter.set('b', '2');
      await adapter.set('c', '3');

      expect(await adapter.count()).toBe(3);
    });

    it('should count keys matching pattern', async () => {
      await adapter.set('user:1', 'a');
      await adapter.set('user:2', 'b');
      await adapter.set('session:1', 'c');

      expect(await adapter.count('user:*')).toBe(2);
    });
  });
});
