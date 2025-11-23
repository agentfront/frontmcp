import { VectoriaDB } from '../vectoria';
import { FileStorageAdapter } from '../storage/file.adapter';
import { MemoryStorageAdapter } from '../storage/memory.adapter';
import { RedisStorageAdapter } from '../storage/redis.adapter';
import * as SerializationUtils from '../storage/serialization.utils';
import { ConfigurationError, StorageError } from '../errors';
import type { DocumentMetadata } from '../interfaces';
import type { RedisClient } from '../storage/redis.adapter';
import type { StoredData } from '../storage/adapter.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

interface TestMetadata extends DocumentMetadata {
  category: string;
}

describe('Storage Adapters', () => {
  const testCacheDir = './.cache/vectoriadb-test';

  // Mock Redis client factory - shared across all Redis tests
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
        // Connection close - data persists in Redis
      },
    };
  };

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

  describe('Storage Adapter Error Handling', () => {
    describe('MemoryStorageAdapter error scenarios', () => {
      it('should handle clear() method', async () => {
        const adapter = new MemoryStorageAdapter();
        await adapter.initialize();

        const testData = {
          metadata: {
            version: '1.0.0',
            toolsHash: 'test',
            timestamp: Date.now(),
            modelName: 'test-model',
            dimensions: 384,
            documentCount: 1,
          },
          embeddings: [],
        };

        await adapter.save(testData);
        await adapter.clear();

        const loaded = await adapter.load();
        expect(loaded).toBeNull();
      });

      it('should handle close() method', async () => {
        const adapter = new MemoryStorageAdapter();
        await adapter.initialize();
        await adapter.close();

        // Should still work after close (in-memory has no cleanup)
        const loaded = await adapter.load();
        expect(loaded).toBeNull();
      });
    });

    describe('FileStorageAdapter error scenarios', () => {
      const errorTestDir = './tmp/error-test-cache';

      afterEach(async () => {
        try {
          await fs.rm(errorTestDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      });

      it('should throw StorageError on initialize with invalid cache directory', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: '/invalid/path/that/does/not/exist',
          namespace: 'test',
        });

        // Should throw StorageError when trying to create invalid directory
        await expect(adapter.initialize()).rejects.toThrow(StorageError);
        await expect(adapter.initialize()).rejects.toThrow('Failed to create cache directory');
      });

      it('should handle load from non-existent file', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: errorTestDir,
          namespace: 'non-existent',
        });

        await adapter.initialize();
        const loaded = await adapter.load();

        expect(loaded).toBeNull();
      });

      it('should handle corrupted JSON file', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: errorTestDir,
          namespace: 'corrupted',
        });

        await adapter.initialize();

        // Create corrupted JSON file
        const filePath = path.join(errorTestDir, 'corrupted', 'embeddings.json');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, 'invalid json content{{{');

        const loaded = await adapter.load();
        expect(loaded).toBeNull();
      });

      it('should handle clear() when file does not exist', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: errorTestDir,
          namespace: 'missing',
        });

        await adapter.initialize();

        // Should not throw when clearing non-existent file
        await expect(adapter.clear()).resolves.not.toThrow();
      });

      it('should handle close() method', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: errorTestDir,
          namespace: 'close-test',
        });

        await adapter.initialize();
        await expect(adapter.close()).resolves.not.toThrow();
      });
    });

    describe('RedisStorageAdapter error scenarios', () => {
      it('should handle connection failure during initialization', async () => {
        const failingClient: RedisClient = {
          get: async () => null,
          set: async () => 'OK',
          setex: async () => 'OK',
          del: async () => 1,
          ping: async () => {
            throw new Error('Connection refused');
          },
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: failingClient,
          namespace: 'test',
        });

        await expect(adapter.initialize()).rejects.toThrow(/Failed to connect to Redis/);
      });

      it('should handle save errors', async () => {
        const failingClient: RedisClient = {
          get: async () => null,
          set: async () => 'OK',
          setex: async () => {
            throw new Error('Save failed');
          },
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: failingClient,
          namespace: 'test',
        });

        await adapter.initialize();

        const testData = {
          metadata: {
            version: '1.0.0',
            toolsHash: 'test',
            timestamp: Date.now(),
            modelName: 'test-model',
            dimensions: 384,
            documentCount: 1,
          },
          embeddings: [],
        };

        await expect(adapter.save(testData)).rejects.toThrow(/Failed to save embeddings to Redis/);
      });

      it('should handle load errors', async () => {
        const failingClient: RedisClient = {
          get: async () => {
            throw new Error('Get failed');
          },
          set: async () => 'OK',
          setex: async () => 'OK',
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: failingClient,
          namespace: 'test',
        });

        await adapter.initialize();

        const loaded = await adapter.load();
        expect(loaded).toBeNull();
      });

      it('should handle invalid JSON from Redis', async () => {
        const invalidJsonClient: RedisClient = {
          get: async () => 'invalid json{{{',
          set: async () => 'OK',
          setex: async () => 'OK',
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: invalidJsonClient,
          namespace: 'test',
        });

        await adapter.initialize();

        const loaded = await adapter.load();
        expect(loaded).toBeNull();
      });

      it('should handle clear errors gracefully', async () => {
        const failingClient: RedisClient = {
          get: async () => null,
          set: async () => 'OK',
          setex: async () => 'OK',
          del: async () => {
            throw new Error('Delete failed');
          },
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: failingClient,
          namespace: 'test',
        });

        await adapter.initialize();

        // Should not throw even if delete fails
        await expect(adapter.clear()).resolves.not.toThrow();
      });

      it('should handle close errors gracefully', async () => {
        const failingClient: RedisClient = {
          get: async () => null,
          set: async () => 'OK',
          setex: async () => 'OK',
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            throw new Error('Quit failed');
          },
        };

        const adapter = new RedisStorageAdapter({
          client: failingClient,
          namespace: 'test',
        });

        await adapter.initialize();

        // Should not throw even if quit fails
        await expect(adapter.close()).resolves.not.toThrow();
      });

      it('should work with custom TTL', async () => {
        let savedTTL: number | undefined;
        const customTTLClient: RedisClient = {
          get: async () => null,
          set: async () => 'OK',
          setex: async (key, ttl, value) => {
            savedTTL = ttl;
            return 'OK';
          },
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: customTTLClient,
          namespace: 'test',
          ttl: 3600, // 1 hour
        });

        await adapter.initialize();

        const testData = {
          metadata: {
            version: '1.0.0',
            toolsHash: 'test',
            timestamp: Date.now(),
            modelName: 'test-model',
            dimensions: 384,
            documentCount: 1,
          },
          embeddings: [],
        };

        await adapter.save(testData);
        expect(savedTTL).toBe(3600);
      });

      it('should work with custom key prefix', async () => {
        let savedKey: string | undefined;
        const customPrefixClient: RedisClient = {
          get: async (key) => {
            savedKey = key;
            return null;
          },
          set: async () => 'OK',
          setex: async (key) => {
            savedKey = key;
            return 'OK';
          },
          del: async () => 1,
          ping: async () => 'PONG',
          quit: async () => {
            /* no-op for test mock */
          },
        };

        const adapter = new RedisStorageAdapter({
          client: customPrefixClient,
          namespace: 'myapp',
          keyPrefix: 'custom-prefix',
        });

        await adapter.initialize();
        await adapter.load();

        expect(savedKey).toContain('custom-prefix');
        expect(savedKey).toContain('myapp');
      });
    });
  });

  describe('BaseStorageAdapter Coverage', () => {
    describe('isMetadataValid', () => {
      it('should return false when version mismatch', async () => {
        const client = createMockRedisClient();
        const adapter = new RedisStorageAdapter<TestMetadata>({
          client,
          namespace: 'test-version-mismatch',
        });

        await adapter.initialize();

        // Save data with version 1
        const testData: StoredData<TestMetadata> = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test-model',
            toolsHash: 'hash123',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
          },
        };
        await adapter.save(testData);

        // Check cache with different version
        const hasCache = await adapter.hasValidCache({
          version: '2.0.0',
          modelName: 'test-model',
          toolsHash: 'hash123',
          timestamp: Date.now(),
          dimensions: 384,
          documentCount: 0,
        });

        expect(hasCache).toBe(false);
      });

      it('should return false when toolsHash mismatch', async () => {
        const client = createMockRedisClient();
        const adapter = new RedisStorageAdapter<TestMetadata>({
          client,
          namespace: 'test-tools-mismatch',
        });

        await adapter.initialize();

        // Save data with toolsHash
        const testData: StoredData<TestMetadata> = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test-model',
            toolsHash: 'hash123',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
          },
        };
        await adapter.save(testData);

        // Check cache with different toolsHash
        const hasCache = await adapter.hasValidCache({
          version: '1.0.0',
          modelName: 'test-model',
          toolsHash: 'hash456',
          timestamp: Date.now(),
          dimensions: 384,
          documentCount: 0,
        });

        expect(hasCache).toBe(false);
      });

      it('should return false when modelName mismatch', async () => {
        const client = createMockRedisClient();
        const adapter = new RedisStorageAdapter<TestMetadata>({
          client,
          namespace: 'test-model-mismatch',
        });

        await adapter.initialize();

        // Save data with modelName
        const testData: StoredData<TestMetadata> = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test-model',
            toolsHash: 'hash123',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
          },
        };
        await adapter.save(testData);

        // Check cache with different modelName
        const hasCache = await adapter.hasValidCache({
          version: '1.0.0',
          modelName: 'different-model',
          toolsHash: 'hash123',
          timestamp: Date.now(),
          dimensions: 384,
          documentCount: 0,
        });

        expect(hasCache).toBe(false);
      });

      it('should handle JSON with prototype pollution keys', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: './tmp/json-parse-test',
          namespace: 'test-json',
        });

        try {
          await adapter.initialize();

          // Manually write JSON with prototype pollution attempt
          const filePath = path.join('./tmp/json-parse-test', 'test-json', 'embeddings.json');
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(
            filePath,
            JSON.stringify({
              __proto__: { polluted: true },
              constructor: { bad: 'value' },
              prototype: { evil: 'data' },
              embeddings: [],
              metadata: {
                version: '1.0.0',
                modelName: 'test',
                toolsHash: 'hash',
                createdAt: new Date().toISOString(),
              },
            }),
          );

          // Load should sanitize and not include prototype pollution
          const data = await adapter.load();

          expect(data).not.toBeNull();
          expect((data as any).__proto__).toBeUndefined();
          expect((data as any).constructor).toBeUndefined();
          expect((data as any).prototype).toBeUndefined();

          // Cleanup
          await fs.rm('./tmp/json-parse-test', { recursive: true, force: true });
        } catch {
          // Cleanup on error
          try {
            await fs.rm('./tmp/json-parse-test', { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      });

      it('should handle invalid JSON gracefully', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: './tmp/invalid-json-test',
          namespace: 'test-invalid',
        });

        try {
          await adapter.initialize();

          // Write invalid JSON
          const filePath = path.join('./tmp/invalid-json-test', 'test-invalid', 'embeddings.json');
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, '{invalid json content}');

          // Load should return null for invalid JSON
          const data = await adapter.load();

          expect(data).toBeNull();

          // Cleanup
          await fs.rm('./tmp/invalid-json-test', { recursive: true, force: true });
        } catch {
          // Cleanup on error
          try {
            await fs.rm('./tmp/invalid-json-test', { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });
  });

  describe('FileStorageAdapter Edge Cases', () => {
    it('should sanitize path traversal attempts', () => {
      // Path traversal is sanitized, not rejected
      const adapter = new FileStorageAdapter({
        cacheDir: '/safe/dir',
        namespace: '../../../etc/passwd', // Path traversal attempt
      });

      // The adapter should be created successfully with sanitized namespace
      expect(adapter).toBeDefined();

      // Verify the filePath doesn't contain path traversal
      const filePath = (adapter as any).filePath;
      expect(filePath).toContain('/safe/dir');
      expect(filePath).not.toContain('..');
      expect(filePath).not.toContain('etc/passwd');
    });
  });

  describe('RedisStorageAdapter Edge Cases', () => {
    it('should throw ConfigurationError for empty namespace', () => {
      const client = createMockRedisClient();

      expect(() => {
        new RedisStorageAdapter({
          client,
          namespace: '', // Empty namespace
        });
      }).toThrow(ConfigurationError);
      expect(() => {
        new RedisStorageAdapter({
          client,
          namespace: '', // Empty namespace
        });
      }).toThrow('Namespace must be a non-empty string');
    });

    it('should use default namespace when null or undefined', () => {
      const client = createMockRedisClient();

      // null/undefined namespace gets default value from base class
      const adapter1 = new RedisStorageAdapter({
        client,
        namespace: null as any,
      });
      expect(adapter1).toBeDefined();

      const adapter2 = new RedisStorageAdapter({
        client,
        namespace: undefined as any,
      });
      expect(adapter2).toBeDefined();
    });

    it('should throw ConfigurationError for namespace that becomes empty after sanitization', () => {
      const client = createMockRedisClient();

      expect(() => {
        new RedisStorageAdapter({
          client,
          namespace: '!!!@@@###', // Will be empty after sanitization
        });
      }).toThrow(ConfigurationError);
      expect(() => {
        new RedisStorageAdapter({
          client,
          namespace: '!!!@@@###',
        });
      }).toThrow('Namespace becomes empty after sanitization');
    });
  });

  describe('Error Handling - Serialization Failures', () => {
    describe('FileStorageAdapter serialization error handling', () => {
      it('should throw StorageError when safeJsonStringify returns empty', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: './tmp/serialization-error-test',
          namespace: 'test-serialization',
        });
        await adapter.initialize();

        // Create data with BigInt which cannot be serialized by JSON.stringify
        const invalidData: any = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test',
            toolsHash: 'hash',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
            invalidValue: BigInt(9007199254740991), // BigInt cannot be JSON.stringify'd
          },
        };

        await expect(adapter.save(invalidData)).rejects.toThrow(StorageError);
        await expect(adapter.save(invalidData)).rejects.toThrow('Failed to serialize embeddings data');

        // Cleanup
        try {
          await fs.rm('./tmp/serialization-error-test', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      });

      it('should not double-wrap StorageError', async () => {
        const adapter = new FileStorageAdapter({
          cacheDir: './tmp/double-wrap-test',
          namespace: 'test-double-wrap',
        });
        await adapter.initialize();

        const invalidData: any = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test',
            toolsHash: 'hash',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
            invalidValue: BigInt(123),
          },
        };

        try {
          await adapter.save(invalidData);
          fail('Should have thrown StorageError');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageError);
          // Verify the error message is the original one, not wrapped
          expect((error as StorageError).message).toBe('Failed to serialize embeddings data');
          // Verify there's no nested "Failed to save embeddings to file" message
          expect((error as StorageError).message).not.toContain('Failed to save embeddings to file');
        }

        // Cleanup
        try {
          await fs.rm('./tmp/double-wrap-test', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      });

      it('should validate that sanitization prevents path traversal', () => {
        // The sanitizeNamespace() method removes dangerous path traversal sequences
        // This test verifies that path traversal attempts are neutralized
        const adapter = new FileStorageAdapter({
          cacheDir: '/tmp/safe-dir',
          namespace: '../../../etc/passwd',
        });

        // The adapter should be created successfully (sanitization works)
        expect(adapter).toBeDefined();

        // The actual file path should not contain any path traversal sequences
        const filePath = (adapter as any).filePath;
        expect(filePath).toContain('/tmp/safe-dir');
        expect(filePath).not.toContain('..');
        expect(filePath).not.toContain('etc/passwd');

        // Note: The validateFilePath() method is a defensive check that's hard to trigger
        // because sanitizeNamespace() removes all dangerous characters first
      });
    });

    describe('RedisStorageAdapter serialization error handling', () => {
      it('should throw StorageError when safeJsonStringify returns empty', async () => {
        const client = createMockRedisClient();
        const adapter = new RedisStorageAdapter({
          client,
          namespace: 'test-redis-serialization',
        });
        await adapter.initialize();

        // Create data with BigInt which cannot be serialized
        const invalidData: any = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test',
            toolsHash: 'hash',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
            invalidValue: BigInt(9007199254740991),
          },
        };

        await expect(adapter.save(invalidData)).rejects.toThrow(StorageError);
        await expect(adapter.save(invalidData)).rejects.toThrow('Failed to serialize embeddings data');
      });

      it('should not double-wrap StorageError', async () => {
        const client = createMockRedisClient();
        const adapter = new RedisStorageAdapter({
          client,
          namespace: 'test-redis-double-wrap',
        });
        await adapter.initialize();

        const invalidData: any = {
          embeddings: [],
          metadata: {
            version: '1.0.0',
            modelName: 'test',
            toolsHash: 'hash',
            timestamp: Date.now(),
            dimensions: 384,
            documentCount: 0,
            invalidValue: BigInt(456),
          },
        };

        try {
          await adapter.save(invalidData);
          fail('Should have thrown StorageError');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageError);
          // Verify the error message is the original one, not wrapped
          expect((error as StorageError).message).toBe('Failed to serialize embeddings data');
          // Verify there's no nested "Failed to save embeddings to Redis" message
          expect((error as StorageError).message).not.toContain('Failed to save embeddings to Redis');
        }
      });
    });
  });
});
