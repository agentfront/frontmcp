/**
 * StorageTokenStore Tests
 *
 * Tests for the StorageTokenStore implementation that uses StorageAdapter
 * for token blob storage.
 */

import { MemoryStorageAdapter, createNamespacedStorage } from '@frontmcp/utils';
import { StorageTokenStore } from '../storage-token-store';
import type { EncBlob } from '../../token.vault';

describe('StorageTokenStore', () => {
  let adapter: MemoryStorageAdapter;
  let tokenStore: StorageTokenStore;

  const createTestBlob = (exp?: number): EncBlob => ({
    alg: 'A256GCM',
    kid: 'test-key-1',
    iv: 'dGVzdC1pdi0xMjM=',
    tag: 'dGVzdC10YWctMTIz',
    data: 'ZW5jcnlwdGVkLWRhdGE=',
    exp,
  });

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    tokenStore = new StorageTokenStore(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('constructor', () => {
    it('should create a StorageTokenStore with default options', () => {
      const store = new StorageTokenStore(adapter);
      expect(store).toBeInstanceOf(StorageTokenStore);
    });

    it('should create a StorageTokenStore with custom namespace', () => {
      const store = new StorageTokenStore(adapter, { namespace: 'custom-tok' });
      expect(store).toBeInstanceOf(StorageTokenStore);
    });

    it('should create a StorageTokenStore with default TTL', () => {
      const store = new StorageTokenStore(adapter, { defaultTtlSeconds: 3600 });
      expect(store).toBeInstanceOf(StorageTokenStore);
    });

    it('should work with NamespacedStorage', async () => {
      const namespaced = createNamespacedStorage(adapter, 'session:abc123');
      const store = new StorageTokenStore(namespaced);
      expect(store).toBeInstanceOf(StorageTokenStore);
    });
  });

  describe('allocId', () => {
    it('should return a unique UUID', () => {
      const id1 = tokenStore.allocId();
      const id2 = tokenStore.allocId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('put', () => {
    it('should store a token blob', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();

      await tokenStore.put(id, blob);

      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
      expect(record?.id).toBe(id);
      expect(record?.blob).toEqual(blob);
    });

    it('should store token with expiration TTL', async () => {
      const id = tokenStore.allocId();
      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const blob = createTestBlob(futureExp);

      await tokenStore.put(id, blob);

      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
      expect(record?.blob.exp).toBe(futureExp);
    });

    it('should update an existing token', async () => {
      const id = tokenStore.allocId();
      const blob1 = createTestBlob();
      const blob2 = { ...createTestBlob(), kid: 'test-key-2' };

      await tokenStore.put(id, blob1);
      await tokenStore.put(id, blob2);

      const record = await tokenStore.get(id);
      expect(record?.blob.kid).toBe('test-key-2');
    });

    it('should set updatedAt timestamp', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();
      const before = Date.now();

      await tokenStore.put(id, blob);

      const record = await tokenStore.get(id);
      expect(record?.updatedAt).toBeGreaterThanOrEqual(before);
      expect(record?.updatedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent id', async () => {
      const record = await tokenStore.get('non-existent-id');
      expect(record).toBeUndefined();
    });

    it('should return the stored record', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();

      await tokenStore.put(id, blob);

      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
      expect(record?.id).toBe(id);
      expect(record?.blob).toEqual(blob);
      expect(record?.updatedAt).toBeDefined();
    });
  });

  describe('del', () => {
    it('should delete an existing token', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();

      await tokenStore.put(id, blob);
      await tokenStore.del(id);

      const record = await tokenStore.get(id);
      expect(record).toBeUndefined();
    });

    it('should not throw for non-existent id', async () => {
      await expect(tokenStore.del('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('TTL handling', () => {
    it('should calculate TTL from blob.exp', async () => {
      const id = tokenStore.allocId();
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const blob = createTestBlob(futureExp);

      await tokenStore.put(id, blob);

      // The record should exist
      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
    });

    it('should use minimum TTL for expired blobs', async () => {
      const id = tokenStore.allocId();
      const pastExp = Math.floor(Date.now() / 1000) - 100; // Expired 100 seconds ago
      const blob = createTestBlob(pastExp);

      await tokenStore.put(id, blob);

      // Record should exist immediately after put (before 1s min TTL expires)
      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
      expect(record?.id).toBe(id);
    });

    it('should use defaultTtlSeconds when blob has no expiration', async () => {
      const storeWithDefaultTtl = new StorageTokenStore(adapter, {
        namespace: 'ttl-test',
        defaultTtlSeconds: 600,
      });

      const id = storeWithDefaultTtl.allocId();
      const blob = createTestBlob(); // No exp

      await storeWithDefaultTtl.put(id, blob);

      const record = await storeWithDefaultTtl.get(id);
      expect(record).toBeDefined();
    });
  });

  describe('namespace handling', () => {
    it('should use default namespace prefix', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();

      await tokenStore.put(id, blob);

      // Check the raw storage has the prefixed key
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('tok:'))).toBe(true);
    });

    it('should use custom namespace prefix', async () => {
      const customStore = new StorageTokenStore(adapter, { namespace: 'custom' });
      const id = customStore.allocId();
      const blob = createTestBlob();

      await customStore.put(id, blob);

      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('custom:'))).toBe(true);
    });

    it('should isolate tokens by namespace', async () => {
      const store1 = new StorageTokenStore(adapter, { namespace: 'ns1' });
      const store2 = new StorageTokenStore(adapter, { namespace: 'ns2' });

      const id = 'shared-id';
      const blob1 = createTestBlob();
      const blob2 = { ...createTestBlob(), kid: 'different-key' };

      await store1.put(id, blob1);
      await store2.put(id, blob2);

      const record1 = await store1.get(id);
      const record2 = await store2.get(id);

      expect(record1?.blob.kid).toBe('test-key-1');
      expect(record2?.blob.kid).toBe('different-key');
    });
  });

  describe('MemoryTokenStore behavior parity', () => {
    it('should behave like MemoryTokenStore for basic operations', async () => {
      const id = tokenStore.allocId();
      const blob = createTestBlob();

      // Put
      await tokenStore.put(id, blob);

      // Get
      const record = await tokenStore.get(id);
      expect(record).toBeDefined();
      expect(record?.id).toBe(id);
      expect(record?.blob).toEqual(blob);
      expect(typeof record?.updatedAt).toBe('number');

      // Del
      await tokenStore.del(id);
      const deleted = await tokenStore.get(id);
      expect(deleted).toBeUndefined();
    });
  });
});
