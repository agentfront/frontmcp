import { VectoriaDB } from '../vectoria';
import { FileStorageAdapter } from '../storage/file.adapter';
import { MemoryStorageAdapter } from '../storage/memory.adapter';
import { RedisStorageAdapter } from '../storage/redis.adapter';
import * as SerializationUtils from '../storage/serialization.utils';
import type { DocumentMetadata } from '../interfaces';
import type { RedisClient } from '../storage/redis.adapter';
import * as fs from 'fs/promises';
import * as path from 'path';

interface TestMetadata extends DocumentMetadata {
  category: string;
}

describe('Storage Adapters', () => {
  const testCacheDir = './.cache/vectoriadb-test';

  afterEach(async () => {
    // Cleanup test cache directory
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('SerializationUtils', () => {
    test('should hash strings consistently', () => {
      const hash1 = SerializationUtils.hash('test-string');
      const hash2 = SerializationUtils.hash('test-string');
      expect(hash1).toBe(hash2);
    });

    test('should create different hashes for different strings', () => {
      const hash1 = SerializationUtils.hash('test-1');
      const hash2 = SerializationUtils.hash('test-2');
      expect(hash1).not.toBe(hash2);
    });

    test('should create tools hash from documents', () => {
      const docs = [
        { id: 'doc-1', text: 'Test 1' },
        { id: 'doc-2', text: 'Test 2' },
      ];
      const hash = SerializationUtils.createToolsHash(docs);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    test('should create same hash for same documents regardless of order', () => {
      const docs1 = [
        { id: 'doc-1', text: 'Test 1' },
        { id: 'doc-2', text: 'Test 2' },
      ];
      const docs2 = [
        { id: 'doc-2', text: 'Test 2' },
        { id: 'doc-1', text: 'Test 1' },
      ];
      const hash1 = SerializationUtils.createToolsHash(docs1);
      const hash2 = SerializationUtils.createToolsHash(docs2);
      expect(hash1).toBe(hash2);
    });
  });

  describe('MemoryStorageAdapter', () => {
    test('should not have cache on startup', async () => {
      const adapter = new MemoryStorageAdapter<TestMetadata>();
      await adapter.initialize();

      const hasCache = await adapter.hasValidCache({
        version: '1.0.0',
        toolsHash: 'test',
        timestamp: Date.now(),
        modelName: 'test',
        dimensions: 384,
        documentCount: 0,
      });

      expect(hasCache).toBe(false);
    });

    test('should load null on first load', async () => {
      const adapter = new MemoryStorageAdapter<TestMetadata>();
      await adapter.initialize();

      const data = await adapter.load();
      expect(data).toBeNull();
    });
  });

  describe('FileStorageAdapter', () => {
    test('should create cache directory', async () => {
      const adapter = new FileStorageAdapter<TestMetadata>({
        cacheDir: testCacheDir,
        namespace: 'test-1',
      });

      await adapter.initialize();

      const dir = path.join(testCacheDir, 'test-1');
      const exists = await fs
        .access(dir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test('should save and load data', async () => {
      const adapter = new FileStorageAdapter<TestMetadata>({
        cacheDir: testCacheDir,
        namespace: 'test-2',
      });

      await adapter.initialize();

      const testData = {
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test-model',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [
          {
            id: 'doc-1',
            vector: [0.1, 0.2, 0.3],
            metadata: { id: 'doc-1', category: 'test' },
            text: 'Test document',
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await adapter.save(testData);

      const loaded = await adapter.load();
      expect(loaded).toBeDefined();
      expect(loaded?.embeddings.length).toBe(1);
      expect(loaded?.embeddings[0].id).toBe('doc-1');
    });

    test('should invalidate cache when tools hash changes', async () => {
      const adapter = new FileStorageAdapter<TestMetadata>({
        cacheDir: testCacheDir,
        namespace: 'test-3',
      });

      await adapter.initialize();

      const testData = {
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test-model',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [],
      };

      await adapter.save(testData);

      // Try to load with different tools hash
      const hasValid = await adapter.hasValidCache({
        version: '1.0.0',
        toolsHash: 'different-hash',
        timestamp: Date.now(),
        modelName: 'test-model',
        dimensions: 384,
        documentCount: 1,
      });

      expect(hasValid).toBe(false);
    });

    test('should clear cache', async () => {
      const adapter = new FileStorageAdapter<TestMetadata>({
        cacheDir: testCacheDir,
        namespace: 'test-4',
      });

      await adapter.initialize();

      const testData = {
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test-model',
          dimensions: 384,
          documentCount: 0,
        },
        embeddings: [],
      };

      await adapter.save(testData);
      await adapter.clear();

      const loaded = await adapter.load();
      expect(loaded).toBeNull();
    });
  });

  describe('RedisStorageAdapter', () => {
    // Mock Redis client
    const createMockRedisClient = (): RedisClient => {
      const storage = new Map<string, string>();

      return {
        async get(key: string) {
          return storage.get(key) ?? null;
        },
        async set(key: string, value: string) {
          storage.set(key, value);
          return 'OK';
        },
        async setex(key: string, _seconds: number, value: string) {
          storage.set(key, value);
          return 'OK';
        },
        async del(key: string) {
          storage.delete(key);
          return 1;
        },
        async ping() {
          return 'PONG';
        },
        async quit() {
          storage.clear();
        },
      };
    };

    test('should initialize with Redis client', async () => {
      const client = createMockRedisClient();
      const adapter = new RedisStorageAdapter<TestMetadata>({
        client,
        namespace: 'test-redis-1',
      });

      await adapter.initialize();
      // No error means success
    });

    test('should save and load data from Redis', async () => {
      const client = createMockRedisClient();
      const adapter = new RedisStorageAdapter<TestMetadata>({
        client,
        namespace: 'test-redis-2',
      });

      await adapter.initialize();

      const testData = {
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test-model',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [
          {
            id: 'doc-1',
            vector: [0.1, 0.2, 0.3],
            metadata: { id: 'doc-1', category: 'test' },
            text: 'Test document',
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await adapter.save(testData);

      const loaded = await adapter.load();
      expect(loaded).toBeDefined();
      expect(loaded?.embeddings.length).toBe(1);
      expect(loaded?.embeddings[0].id).toBe('doc-1');
    });

    test('should clear Redis cache', async () => {
      const client = createMockRedisClient();
      const adapter = new RedisStorageAdapter<TestMetadata>({
        client,
        namespace: 'test-redis-3',
      });

      await adapter.initialize();

      const testData = {
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test-model',
          dimensions: 384,
          documentCount: 0,
        },
        embeddings: [],
      };

      await adapter.save(testData);
      await adapter.clear();

      const loaded = await adapter.load();
      expect(loaded).toBeNull();
    });
  });

  describe('VectoriaDB with Storage', () => {
    describe('with FileStorageAdapter', () => {
      test('should save and restore embeddings across restarts', async () => {
        const docs = [
          { id: 'doc-1', text: 'Machine learning basics', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Cooking pasta', metadata: { id: 'doc-2', category: 'food' } },
        ];

        const toolsHash = SerializationUtils.createToolsHash(docs);

        // First instance - create and save
        const db1 = new VectoriaDB<TestMetadata>({
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-test-1',
          }),
          toolsHash,
          version: '1.0.0',
        });

        await db1.initialize();
        await db1.addMany(docs);
        await db1.saveToStorage();

        expect(db1.size()).toBe(2);

        // Second instance - load from storage
        const db2 = new VectoriaDB<TestMetadata>({
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-test-1',
          }),
          toolsHash,
          version: '1.0.0',
        });

        await db2.initialize();

        expect(db2.size()).toBe(2);
        expect(db2.has('doc-1')).toBe(true);
        expect(db2.has('doc-2')).toBe(true);

        const doc1 = db2.get('doc-1');
        expect(doc1?.text).toBe('Machine learning basics');
      }, 60000);

      test('should invalidate cache when tools change', async () => {
        const docs1 = [{ id: 'doc-1', text: 'Original text', metadata: { id: 'doc-1', category: 'test' } }];

        const toolsHash1 = SerializationUtils.createToolsHash(docs1);

        // First instance
        const db1 = new VectoriaDB<TestMetadata>({
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-test-2',
          }),
          toolsHash: toolsHash1,
          version: '1.0.0',
        });

        await db1.initialize();
        await db1.addMany(docs1);
        await db1.saveToStorage();

        expect(db1.size()).toBe(1);

        // Second instance with different tools
        const docs2 = [{ id: 'doc-1', text: 'Changed text', metadata: { id: 'doc-1', category: 'test' } }];

        const toolsHash2 = SerializationUtils.createToolsHash(docs2);

        const db2 = new VectoriaDB<TestMetadata>({
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-test-2',
          }),
          toolsHash: toolsHash2,
          version: '1.0.0',
        });

        await db2.initialize();

        // Cache should be invalidated, database should be empty
        expect(db2.size()).toBe(0);
      }, 60000);

      test('should work with HNSW index after restore', async () => {
        const docs = [
          { id: 'doc-1', text: 'Machine learning', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Deep learning', metadata: { id: 'doc-2', category: 'tech' } },
          { id: 'doc-3', text: 'Cooking', metadata: { id: 'doc-3', category: 'food' } },
        ];

        const toolsHash = SerializationUtils.createToolsHash(docs);

        // First instance with HNSW
        const db1 = new VectoriaDB<TestMetadata>({
          useHNSW: true,
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-hnsw-test',
          }),
          toolsHash,
          version: '1.0.0',
        });

        await db1.initialize();
        await db1.addMany(docs);
        await db1.saveToStorage();

        // Second instance - restore with HNSW
        const db2 = new VectoriaDB<TestMetadata>({
          useHNSW: true,
          storageAdapter: new FileStorageAdapter({
            cacheDir: testCacheDir,
            namespace: 'vectoria-hnsw-test',
          }),
          toolsHash,
          version: '1.0.0',
        });

        await db2.initialize();

        expect(db2.size()).toBe(3);

        // HNSW search should work - verify we can search after restore
        const results = await db2.search('learning', { threshold: 0 });
        expect(results.length).toBeGreaterThan(0); // Should find at least the "learning" documents

        // Verify the tech documents are found
        const techDocs = results.filter((r) => r.metadata.category === 'tech');
        expect(techDocs.length).toBeGreaterThan(0);
      }, 60000);
    });
  });
});
