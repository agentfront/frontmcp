/**
 * TypedStorage Tests
 *
 * Tests for the TypedStorage wrapper that provides type-safe JSON serialization
 * on top of StorageAdapter.
 */

import { z } from 'zod';
import { MemoryStorageAdapter } from '@frontmcp/utils';
import { TypedStorage } from '../typed-storage';

interface TestUser {
  id: string;
  name: string;
  email?: string;
}

const testUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
});

describe('TypedStorage', () => {
  let adapter: MemoryStorageAdapter;
  let storage: TypedStorage<TestUser>;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    storage = new TypedStorage<TestUser>(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('constructor', () => {
    it('should create a TypedStorage with default options', () => {
      const ts = new TypedStorage<TestUser>(adapter);
      expect(ts).toBeInstanceOf(TypedStorage);
    });

    it('should create a TypedStorage with schema validation', () => {
      const ts = new TypedStorage<TestUser>(adapter, { schema: testUserSchema });
      expect(ts).toBeInstanceOf(TypedStorage);
    });

    it('should create a TypedStorage with custom serializer', () => {
      const ts = new TypedStorage<TestUser>(adapter, {
        serialize: (value) => JSON.stringify(value),
        deserialize: (raw) => JSON.parse(raw),
      });
      expect(ts).toBeInstanceOf(TypedStorage);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve a typed value', async () => {
      const user: TestUser = { id: '1', name: 'Alice', email: 'alice@test.com' };
      await storage.set('user:1', user);

      const retrieved = await storage.get('user:1');
      expect(retrieved).toEqual(user);
    });

    it('should return null for non-existent key', async () => {
      const result = await storage.get('non-existent');
      expect(result).toBeNull();
    });

    it('should support TTL option', async () => {
      const user: TestUser = { id: '1', name: 'Alice' };
      await storage.set('user:1', user, { ttlSeconds: 3600 });

      const result = await storage.get('user:1');
      expect(result).toEqual(user);

      const ttl = await storage.ttl('user:1');
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(ttl).toBeGreaterThan(0);
    });

    it('should support conditional set with ifNotExists', async () => {
      const user1: TestUser = { id: '1', name: 'Alice' };
      const user2: TestUser = { id: '1', name: 'Bob' };

      await storage.set('user:1', user1);
      await storage.set('user:1', user2, { ifNotExists: true });

      const result = await storage.get('user:1');
      expect(result).toEqual(user1); // Should not be overwritten
    });
  });

  describe('delete', () => {
    it('should delete an existing key', async () => {
      const user: TestUser = { id: '1', name: 'Alice' };
      await storage.set('user:1', user);

      const deleted = await storage.delete('user:1');
      expect(deleted).toBe(true);

      const result = await storage.get('user:1');
      expect(result).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const deleted = await storage.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      const user: TestUser = { id: '1', name: 'Alice' };
      await storage.set('user:1', user);

      const exists = await storage.exists('user:1');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const exists = await storage.exists('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('mget/mset', () => {
    it('should store and retrieve multiple values', async () => {
      const users: TestUser[] = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
      ];

      await storage.mset(users.map((u) => ({ key: `user:${u.id}`, value: u })));

      const retrieved = await storage.mget(['user:1', 'user:2', 'user:3']);
      expect(retrieved).toEqual(users);
    });

    it('should return null for missing keys in mget', async () => {
      const user: TestUser = { id: '1', name: 'Alice' };
      await storage.set('user:1', user);

      const retrieved = await storage.mget(['user:1', 'user:2']);
      expect(retrieved).toEqual([user, null]);
    });

    it('should handle empty arrays', async () => {
      await storage.mset([]);
      const result = await storage.mget([]);
      expect(result).toEqual([]);
    });
  });

  describe('mdelete', () => {
    it('should delete multiple keys', async () => {
      const users: TestUser[] = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];

      await storage.mset(users.map((u) => ({ key: `user:${u.id}`, value: u })));

      const deleted = await storage.mdelete(['user:1', 'user:2']);
      expect(deleted).toBe(2);

      const exists1 = await storage.exists('user:1');
      const exists2 = await storage.exists('user:2');
      expect(exists1).toBe(false);
      expect(exists2).toBe(false);
    });
  });

  describe('expire/ttl', () => {
    it('should set TTL on existing key', async () => {
      const user: TestUser = { id: '1', name: 'Alice' };
      await storage.set('user:1', user);

      const result = await storage.expire('user:1', 3600);
      expect(result).toBe(true);

      const ttl = await storage.ttl('user:1');
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(ttl).toBeGreaterThan(0);
    });

    it('should return false for non-existent key', async () => {
      const result = await storage.expire('non-existent', 3600);
      expect(result).toBe(false);
    });

    it('should return null for non-existent key in ttl', async () => {
      const ttl = await storage.ttl('non-existent');
      expect(ttl).toBeNull();
    });
  });

  describe('keys/count', () => {
    it('should list keys matching pattern', async () => {
      const users: TestUser[] = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];

      await storage.mset(users.map((u) => ({ key: `user:${u.id}`, value: u })));
      await storage.set('other:1', { id: 'x', name: 'Other' });

      const keys = await storage.keys('user:*');
      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });

    it('should count keys matching pattern', async () => {
      const users: TestUser[] = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
      ];

      await storage.mset(users.map((u) => ({ key: `user:${u.id}`, value: u })));

      const count = await storage.count('user:*');
      expect(count).toBe(3);
    });
  });

  describe('schema validation', () => {
    it('should validate data against schema on read', async () => {
      const validatedStorage = new TypedStorage<TestUser>(adapter, {
        schema: testUserSchema,
      });

      const user: TestUser = { id: '1', name: 'Alice' };
      await validatedStorage.set('user:1', user);

      const result = await validatedStorage.get('user:1');
      expect(result).toEqual(user);
    });

    it('should return null for invalid data when throwOnInvalid is false', async () => {
      const validatedStorage = new TypedStorage<TestUser>(adapter, {
        schema: testUserSchema,
        throwOnInvalid: false,
      });

      // Store invalid data directly
      await adapter.set('user:invalid', JSON.stringify({ invalid: 'data' }));

      const result = await validatedStorage.get('user:invalid');
      expect(result).toBeNull();
    });

    it('should throw for invalid data when throwOnInvalid is true', async () => {
      const validatedStorage = new TypedStorage<TestUser>(adapter, {
        schema: testUserSchema,
        throwOnInvalid: true,
      });

      // Store invalid data directly
      await adapter.set('user:invalid', JSON.stringify({ invalid: 'data' }));

      await expect(validatedStorage.get('user:invalid')).rejects.toThrow();
    });
  });

  describe('custom serialization', () => {
    it('should use custom serializer', async () => {
      let serializeCalled = false;
      let deserializeCalled = false;

      const customStorage = new TypedStorage<TestUser>(adapter, {
        serialize: (value) => {
          serializeCalled = true;
          return JSON.stringify({ ...value, _custom: true });
        },
        deserialize: (raw) => {
          deserializeCalled = true;
          const parsed = JSON.parse(raw);
          delete parsed._custom;
          return parsed;
        },
      });

      const user: TestUser = { id: '1', name: 'Alice' };
      await customStorage.set('user:1', user);
      expect(serializeCalled).toBe(true);

      const result = await customStorage.get('user:1');
      expect(deserializeCalled).toBe(true);
      expect(result).toEqual(user);
    });
  });

  describe('raw access', () => {
    it('should expose the underlying storage adapter', async () => {
      expect(storage.raw).toBe(adapter);
    });
  });

  describe('error handling', () => {
    it('should return null for invalid JSON', async () => {
      await adapter.set('invalid:json', 'not valid json');

      const result = await storage.get('invalid:json');
      expect(result).toBeNull();
    });

    it('should throw for invalid JSON when throwOnInvalid is true', async () => {
      const throwingStorage = new TypedStorage<TestUser>(adapter, {
        throwOnInvalid: true,
      });

      await adapter.set('invalid:json', 'not valid json');

      await expect(throwingStorage.get('invalid:json')).rejects.toThrow();
    });
  });
});
