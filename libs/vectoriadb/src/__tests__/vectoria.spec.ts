import { VectoriaDB } from '../vectoria';
import { DocumentMetadata } from '../interfaces';
import {
  VectoriaNotInitializedError,
  DocumentValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  DuplicateDocumentError,
  QueryValidationError,
} from '../errors';

interface TestMetadata extends DocumentMetadata {
  category: string;
  author?: string;
  tags?: string[];
}

describe('VectoriaDB', () => {
  let db: VectoriaDB<TestMetadata>;

  beforeAll(async () => {
    db = new VectoriaDB<TestMetadata>();
    await db.initialize();
  }, 60000);

  afterEach(() => {
    db.clear();
  });

  describe('initialization', () => {
    test('should initialize successfully', () => {
      expect(db.isInitialized()).toBe(true);
    });

    test('should start with zero documents', () => {
      expect(db.size()).toBe(0);
    });
  });

  describe('add', () => {
    test('should add a document', async () => {
      await db.add('doc-1', 'Test document', {
        id: 'doc-1',
        category: 'test',
      });

      expect(db.size()).toBe(1);
      expect(db.has('doc-1')).toBe(true);
    });

    test('should store document with metadata', async () => {
      const metadata: TestMetadata = {
        id: 'doc-1',
        category: 'test',
        author: 'Alice',
        tags: ['tag1', 'tag2'],
      };

      await db.add('doc-1', 'Test document', metadata);

      const doc = db.get('doc-1');
      expect(doc).toBeDefined();
      expect(doc?.metadata).toEqual(metadata);
      expect(doc?.text).toBe('Test document');
    });

    test('should throw error when adding duplicate document id', async () => {
      await db.add('doc-1', 'First version', {
        id: 'doc-1',
        category: 'test',
      });

      await expect(
        db.add('doc-1', 'Second version', {
          id: 'doc-1',
          category: 'updated',
        }),
      ).rejects.toThrow(DocumentExistsError);

      // Original document should remain unchanged
      expect(db.size()).toBe(1);
      const doc = db.get('doc-1');
      expect(doc?.text).toBe('First version');
      expect(doc?.metadata.category).toBe('test');
    });
  });

  describe('addMany', () => {
    test('should add multiple documents', async () => {
      const docs = [
        {
          id: 'doc-1',
          text: 'Document 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Document 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
        {
          id: 'doc-3',
          text: 'Document 3',
          metadata: { id: 'doc-3', category: 'other' },
        },
      ];

      await db.addMany(docs);

      expect(db.size()).toBe(3);
      expect(db.has('doc-1')).toBe(true);
      expect(db.has('doc-2')).toBe(true);
      expect(db.has('doc-3')).toBe(true);
    });

    test('should handle empty array', async () => {
      await db.addMany([]);
      expect(db.size()).toBe(0);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Create a new user account in the system',
          metadata: {
            id: 'doc-1',
            category: 'auth',
            tags: ['user', 'create'],
          },
        },
        {
          id: 'doc-2',
          text: 'Delete an existing user account',
          metadata: {
            id: 'doc-2',
            category: 'auth',
            tags: ['user', 'delete'],
          },
        },
        {
          id: 'doc-3',
          text: 'Send email notifications to users',
          metadata: {
            id: 'doc-3',
            category: 'notification',
            tags: ['email', 'notify'],
          },
        },
        {
          id: 'doc-4',
          text: 'Upload files to cloud storage',
          metadata: {
            id: 'doc-4',
            category: 'storage',
            tags: ['file', 'upload'],
          },
        },
      ]);
    });

    test('should find relevant documents', async () => {
      const results = await db.search('creating new accounts');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('doc-1'); // Most relevant
      expect(results[0].score).toBeGreaterThan(0.3);
    });

    test('should return results sorted by score', async () => {
      const results = await db.search('user management', { topK: 3 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    test('should respect topK parameter', async () => {
      const results = await db.search('user', { topK: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('should respect threshold parameter', async () => {
      const results = await db.search('user', { threshold: 0.8 });

      results.forEach((result) => {
        expect(result.score).toBeGreaterThanOrEqual(0.8);
      });
    });

    test('should filter by metadata', async () => {
      const results = await db.search('user', {
        filter: (metadata) => metadata.category === 'auth',
      });

      results.forEach((result) => {
        expect(result.metadata.category).toBe('auth');
      });
    });

    test('should handle complex filters', async () => {
      const results = await db.search('user', {
        filter: (metadata) => metadata.category === 'auth' && metadata.tags?.includes('create') === true,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.metadata.category).toBe('auth');
        expect(result.metadata.tags).toContain('create');
      });
    });

    test('should return empty array for no matches', async () => {
      const results = await db.search('completely unrelated xyz abc', {
        threshold: 0.9,
      });

      expect(results).toEqual([]);
    });

    test('should include vector when requested', async () => {
      const results = await db.search('user', {
        includeVector: true,
        topK: 1,
      });

      expect(results[0].vector).toBeDefined();
      expect(results[0].vector).toBeInstanceOf(Float32Array);
    });

    test('should not include vector by default', async () => {
      const results = await db.search('user', { topK: 1 });

      expect(results[0].vector).toBeUndefined();
    });
  });

  describe('get', () => {
    test('should retrieve document by id', async () => {
      await db.add('doc-1', 'Test', {
        id: 'doc-1',
        category: 'test',
      });

      const doc = db.get('doc-1');
      expect(doc).toBeDefined();
      expect(doc?.id).toBe('doc-1');
      expect(doc?.text).toBe('Test');
    });

    test('should return undefined for non-existent id', () => {
      const doc = db.get('non-existent');
      expect(doc).toBeUndefined();
    });
  });

  describe('has', () => {
    test('should return true for existing document', async () => {
      await db.add('doc-1', 'Test', {
        id: 'doc-1',
        category: 'test',
      });

      expect(db.has('doc-1')).toBe(true);
    });

    test('should return false for non-existent document', () => {
      expect(db.has('non-existent')).toBe(false);
    });
  });

  describe('remove', () => {
    test('should remove a document', async () => {
      await db.add('doc-1', 'Test', {
        id: 'doc-1',
        category: 'test',
      });

      expect(db.has('doc-1')).toBe(true);

      const removed = db.remove('doc-1');
      expect(removed).toBe(true);
      expect(db.has('doc-1')).toBe(false);
      expect(db.size()).toBe(0);
    });

    test('should return false for non-existent document', () => {
      const removed = db.remove('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('removeMany', () => {
    test('should remove multiple documents', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
        {
          id: 'doc-3',
          text: 'Test 3',
          metadata: { id: 'doc-3', category: 'test' },
        },
      ]);

      const removed = db.removeMany(['doc-1', 'doc-3']);
      expect(removed).toBe(2);
      expect(db.size()).toBe(1);
      expect(db.has('doc-2')).toBe(true);
    });

    test('should handle non-existent ids', () => {
      const removed = db.removeMany(['non-existent-1', 'non-existent-2']);
      expect(removed).toBe(0);
    });
  });

  describe('clear', () => {
    test('should remove all documents', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
      ]);

      expect(db.size()).toBe(2);

      db.clear();

      expect(db.size()).toBe(0);
      expect(db.has('doc-1')).toBe(false);
      expect(db.has('doc-2')).toBe(false);
    });
  });

  describe('filter', () => {
    beforeEach(async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: {
            id: 'doc-1',
            category: 'auth',
            author: 'Alice',
          },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: {
            id: 'doc-2',
            category: 'auth',
            author: 'Bob',
          },
        },
        {
          id: 'doc-3',
          text: 'Test 3',
          metadata: {
            id: 'doc-3',
            category: 'notification',
            author: 'Alice',
          },
        },
      ]);
    });

    test('should filter by category', () => {
      const results = db.filter((metadata) => metadata.category === 'auth');

      expect(results.length).toBe(2);
      results.forEach((doc) => {
        expect(doc.metadata.category).toBe('auth');
      });
    });

    test('should filter by author', () => {
      const results = db.filter((metadata) => metadata.author === 'Alice');

      expect(results.length).toBe(2);
      results.forEach((doc) => {
        expect(doc.metadata.author).toBe('Alice');
      });
    });

    test('should handle complex filters', () => {
      const results = db.filter((metadata) => metadata.category === 'auth' && metadata.author === 'Alice');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc-1');
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
      ]);

      const stats = db.getStats();

      expect(stats.totalEmbeddings).toBe(2);
      expect(stats.dimensions).toBe(384);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
      expect(stats.modelName).toContain('MiniLM');
    });
  });

  describe('keys and values', () => {
    test('should return all keys', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
      ]);

      const keys = db.keys();
      expect(keys).toContain('doc-1');
      expect(keys).toContain('doc-2');
      expect(keys.length).toBe(2);
    });

    test('should return all values', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
      ]);

      const values = db.values();
      expect(values.length).toBe(2);
      expect(values[0].text).toBeDefined();
      expect(values[0].metadata).toBeDefined();
    });
  });

  describe('getAll', () => {
    test('should return all documents', async () => {
      await db.addMany([
        {
          id: 'doc-1',
          text: 'Test 1',
          metadata: { id: 'doc-1', category: 'test' },
        },
        {
          id: 'doc-2',
          text: 'Test 2',
          metadata: { id: 'doc-2', category: 'test' },
        },
      ]);

      const all = db.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('initialization requirements', () => {
    let uninitializedDb: VectoriaDB<TestMetadata>;

    beforeEach(() => {
      uninitializedDb = new VectoriaDB<TestMetadata>();
    });

    test('should throw error when adding document before initialization', async () => {
      await expect(uninitializedDb.add('doc-1', 'Test', { id: 'doc-1', category: 'test' })).rejects.toThrow(
        VectoriaNotInitializedError,
      );
    });

    test('should throw error when adding many documents before initialization', async () => {
      await expect(
        uninitializedDb.addMany([{ id: 'doc-1', text: 'Test', metadata: { id: 'doc-1', category: 'test' } }]),
      ).rejects.toThrow(VectoriaNotInitializedError);
    });

    test('should throw error when searching before initialization', async () => {
      await expect(uninitializedDb.search('test query')).rejects.toThrow(VectoriaNotInitializedError);
    });

    test('should throw error when getting stats before initialization', () => {
      expect(() => uninitializedDb.getStats()).toThrow(VectoriaNotInitializedError);
    });

    test('isInitialized should return false before initialization', () => {
      expect(uninitializedDb.isInitialized()).toBe(false);
    });

    test('isInitialized should return true after initialization', async () => {
      await uninitializedDb.initialize();
      expect(uninitializedDb.isInitialized()).toBe(true);
    });
  });

  describe('duplicate ID handling', () => {
    test('should throw error when adding duplicate in addMany batch', async () => {
      await expect(
        db.addMany([
          { id: 'doc-1', text: 'First', metadata: { id: 'doc-1', category: 'test' } },
          { id: 'doc-1', text: 'Duplicate', metadata: { id: 'doc-1', category: 'test' } },
        ]),
      ).rejects.toThrow(DuplicateDocumentError);

      // No documents should be added if batch fails
      expect(db.size()).toBe(0);
    });

    test('should throw error when addMany contains ID that already exists', async () => {
      await db.add('doc-1', 'Existing', { id: 'doc-1', category: 'test' });

      await expect(
        db.addMany([
          { id: 'doc-2', text: 'New', metadata: { id: 'doc-2', category: 'test' } },
          { id: 'doc-1', text: 'Duplicate', metadata: { id: 'doc-1', category: 'test' } },
        ]),
      ).rejects.toThrow(DuplicateDocumentError);

      // Original document should remain, new ones should not be added
      expect(db.size()).toBe(1);
      expect(db.get('doc-2')).toBeUndefined();
    });

    test('should successfully add after removing duplicate', async () => {
      await db.add('doc-1', 'First version', { id: 'doc-1', category: 'test' });

      db.remove('doc-1');

      await db.add('doc-1', 'Second version', { id: 'doc-1', category: 'updated' });

      const doc = db.get('doc-1');
      expect(doc?.text).toBe('Second version');
      expect(doc?.metadata.category).toBe('updated');
    });
  });

  describe('configuration edge cases', () => {
    test('should handle 0 as valid dimension value', () => {
      const customDb = new VectoriaDB({ dimensions: 0 });
      // Dimensions should be 0, not fall back to default 384
      expect((customDb as any).config.dimensions).toBe(0);
    });

    test('should handle custom cache directory', () => {
      const customDb = new VectoriaDB({ cacheDir: '/custom/path' });
      expect((customDb as any).config.cacheDir).toBe('/custom/path');
    });

    test('should handle 0 as valid topK value', () => {
      const customDb = new VectoriaDB({ defaultTopK: 0 });
      expect((customDb as any).config.defaultTopK).toBe(0);
    });

    test('should handle 0 as valid similarity threshold', () => {
      const customDb = new VectoriaDB({ defaultSimilarityThreshold: 0 });
      expect((customDb as any).config.defaultSimilarityThreshold).toBe(0);
    });

    test('should use defaults when config values are null', () => {
      const customDb = new VectoriaDB({
        modelName: null as any,
        cacheDir: null as any,
        dimensions: null as any,
      });
      expect((customDb as any).config.modelName).toBe('Xenova/all-MiniLM-L6-v2');
      expect((customDb as any).config.cacheDir).toBe('./.cache/transformers');
      expect((customDb as any).config.dimensions).toBe(384);
    });

    test('should use defaults when config values are undefined', () => {
      const customDb = new VectoriaDB({
        modelName: undefined,
        cacheDir: undefined,
        dimensions: undefined,
      });
      expect((customDb as any).config.modelName).toBe('Xenova/all-MiniLM-L6-v2');
      expect((customDb as any).config.cacheDir).toBe('./.cache/transformers');
      expect((customDb as any).config.dimensions).toBe(384);
    });
  });

  describe('input validation', () => {
    describe('add validation', () => {
      test('should throw error for empty text', async () => {
        await expect(db.add('doc-1', '', { id: 'doc-1', category: 'test' })).rejects.toThrow(DocumentValidationError);
      });

      test('should throw error for whitespace-only text', async () => {
        await expect(db.add('doc-1', '   ', { id: 'doc-1', category: 'test' })).rejects.toThrow(
          DocumentValidationError,
        );
      });
    });

    describe('addMany validation', () => {
      test('should throw error for document with empty text', async () => {
        await expect(
          db.addMany([
            { id: 'doc-1', text: 'Valid text', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'doc-2', text: '', metadata: { id: 'doc-2', category: 'test' } },
          ]),
        ).rejects.toThrow(DocumentValidationError);

        // No documents should be added if validation fails
        expect(db.size()).toBe(0);
      });

      test('should throw error for document with whitespace-only text', async () => {
        await expect(
          db.addMany([{ id: 'doc-1', text: '   \n\t  ', metadata: { id: 'doc-1', category: 'test' } }]),
        ).rejects.toThrow(DocumentValidationError);
      });
    });

    describe('search validation', () => {
      test('should throw error for empty query', async () => {
        await expect(db.search('')).rejects.toThrow(QueryValidationError);
      });

      test('should throw error for whitespace-only query', async () => {
        await expect(db.search('   \n\t  ')).rejects.toThrow(QueryValidationError);
      });

      test('should throw error for negative topK', async () => {
        await expect(db.search('test', { topK: -1 })).rejects.toThrow(QueryValidationError);
      });

      test('should throw error for zero topK', async () => {
        await expect(db.search('test', { topK: 0 })).rejects.toThrow(QueryValidationError);
      });

      test('should throw error for threshold below 0', async () => {
        await expect(db.search('test', { threshold: -0.5 })).rejects.toThrow(QueryValidationError);
      });

      test('should throw error for threshold above 1', async () => {
        await expect(db.search('test', { threshold: 1.5 })).rejects.toThrow(QueryValidationError);
      });

      test('should accept threshold of 0', async () => {
        await db.add('doc-1', 'test document', { id: 'doc-1', category: 'test' });
        const results = await db.search('test', { threshold: 0 });
        expect(results).toBeDefined();
      });

      test('should accept threshold of 1', async () => {
        await db.add('doc-1', 'test document', { id: 'doc-1', category: 'test' });
        const results = await db.search('test', { threshold: 1 });
        expect(results).toBeDefined();
      });
    });
  });

  describe('HNSW integration', () => {
    let hnswDb: VectoriaDB<TestMetadata>;

    beforeAll(async () => {
      hnswDb = new VectoriaDB<TestMetadata>({
        useHNSW: true,
        hnsw: {
          M: 16,
          efConstruction: 200,
          efSearch: 50,
        },
      });
      await hnswDb.initialize();
    }, 60000);

    afterEach(() => {
      hnswDb.clear();
    });

    describe('configuration', () => {
      test('should create database with HNSW enabled', () => {
        expect(hnswDb.isInitialized()).toBe(true);
      });

      test('should accept custom HNSW parameters', () => {
        const customDb = new VectoriaDB<TestMetadata>({
          useHNSW: true,
          hnsw: {
            M: 32,
            M0: 64,
            efConstruction: 400,
            efSearch: 100,
          },
        });
        expect(customDb).toBeDefined();
      });
    });

    describe('add with HNSW', () => {
      test('should add document to HNSW index', async () => {
        await hnswDb.add('doc-1', 'Machine learning is fascinating', {
          id: 'doc-1',
          category: 'tech',
        });

        expect(hnswDb.size()).toBe(1);
        expect(hnswDb.has('doc-1')).toBe(true);
      });

      test('should add multiple documents to HNSW index', async () => {
        const docs = [
          { id: 'doc-1', text: 'Machine learning basics', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Deep learning tutorial', metadata: { id: 'doc-2', category: 'tech' } },
          { id: 'doc-3', text: 'Cooking recipes', metadata: { id: 'doc-3', category: 'food' } },
        ];

        await hnswDb.addMany(docs);
        expect(hnswDb.size()).toBe(3);
      });
    });

    describe('search with HNSW', () => {
      beforeEach(async () => {
        await hnswDb.addMany([
          { id: 'doc-1', text: 'Machine learning and AI', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Deep learning neural networks', metadata: { id: 'doc-2', category: 'tech' } },
          { id: 'doc-3', text: 'Cooking Italian pasta', metadata: { id: 'doc-3', category: 'food' } },
          { id: 'doc-4', text: 'Python programming language', metadata: { id: 'doc-4', category: 'tech' } },
          { id: 'doc-5', text: 'Baking chocolate cake', metadata: { id: 'doc-5', category: 'food' } },
        ]);
      });

      test('should find relevant documents using HNSW', async () => {
        const results = await hnswDb.search('artificial intelligence');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].score).toBeGreaterThan(0);
        // Tech documents should be more relevant
        expect(['doc-1', 'doc-2', 'doc-4']).toContain(results[0].id);
      });

      test('should return top-k results with HNSW', async () => {
        const results = await hnswDb.search('technology', { topK: 2 });

        expect(results.length).toBeLessThanOrEqual(2);
      });

      test('should filter results with HNSW', async () => {
        const results = await hnswDb.search('food', {
          filter: (metadata) => metadata.category === 'food',
        });

        expect(results.length).toBeGreaterThan(0);
        results.forEach((result) => {
          expect(result.metadata.category).toBe('food');
        });
      });

      test('should respect similarity threshold with HNSW', async () => {
        const results = await hnswDb.search('cooking', { threshold: 0.7 });

        results.forEach((result) => {
          expect(result.score).toBeGreaterThanOrEqual(0.7);
        });
      });

      test('should handle searches on large datasets', async () => {
        // Add more documents to test HNSW performance characteristics
        const largeBatch: Array<{ id: string; text: string; metadata: TestMetadata }> = [];
        for (let i = 0; i < 50; i++) {
          largeBatch.push({
            id: `doc-${i + 10}`,
            text: `Document about topic ${i % 10}`,
            metadata: { id: `doc-${i + 10}`, category: `category-${i % 5}` },
          });
        }
        await hnswDb.addMany(largeBatch);

        const results = await hnswDb.search('topic');
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('remove with HNSW', () => {
      beforeEach(async () => {
        await hnswDb.addMany([
          { id: 'doc-1', text: 'First document', metadata: { id: 'doc-1', category: 'test' } },
          { id: 'doc-2', text: 'Second document', metadata: { id: 'doc-2', category: 'test' } },
          { id: 'doc-3', text: 'Third document', metadata: { id: 'doc-3', category: 'test' } },
        ]);
      });

      test('should remove document from HNSW index', () => {
        const removed = hnswDb.remove('doc-2');
        expect(removed).toBe(true);
        expect(hnswDb.size()).toBe(2);
        expect(hnswDb.has('doc-2')).toBe(false);
      });

      test('should update search results after removal', async () => {
        hnswDb.remove('doc-1');

        const results = await hnswDb.search('document');
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain('doc-1');
      });

      test('should handle removing multiple documents', () => {
        const removed = hnswDb.removeMany(['doc-1', 'doc-3']);
        expect(removed).toBe(2);
        expect(hnswDb.size()).toBe(1);
      });
    });

    describe('clear with HNSW', () => {
      test('should clear all documents from HNSW index', async () => {
        await hnswDb.addMany([
          { id: 'doc-1', text: 'First', metadata: { id: 'doc-1', category: 'test' } },
          { id: 'doc-2', text: 'Second', metadata: { id: 'doc-2', category: 'test' } },
        ]);

        hnswDb.clear();
        expect(hnswDb.size()).toBe(0);

        const results = await hnswDb.search('test');
        expect(results.length).toBe(0);
      });
    });

    describe('HNSW vs brute-force comparison', () => {
      test('should produce similar results to brute-force search', async () => {
        // Use same seed data for both
        const docs = [
          { id: 'doc-1', text: 'Machine learning algorithms', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Neural network architecture', metadata: { id: 'doc-2', category: 'tech' } },
          { id: 'doc-3', text: 'Cooking Italian cuisine', metadata: { id: 'doc-3', category: 'food' } },
          { id: 'doc-4', text: 'Python data science', metadata: { id: 'doc-4', category: 'tech' } },
        ];

        // HNSW results
        await hnswDb.addMany(docs);
        const hnswResults = await hnswDb.search('machine learning', { topK: 2 });

        // Brute-force results
        const bruteDb = new VectoriaDB<TestMetadata>();
        await bruteDb.initialize();
        await bruteDb.addMany(docs);
        const bruteResults = await bruteDb.search('machine learning', { topK: 2 });

        // Top result should be the same (or very similar)
        expect(hnswResults[0].id).toBe(bruteResults[0].id);
        expect(hnswResults.length).toBe(bruteResults.length);
      });
    });

    describe('edge cases with HNSW', () => {
      test('should handle single document', async () => {
        await hnswDb.add('doc-1', 'Only document', { id: 'doc-1', category: 'test' });

        const results = await hnswDb.search('document');
        expect(results.length).toBe(1);
        expect(results[0].id).toBe('doc-1');
      });

      test('should handle duplicate IDs with HNSW', async () => {
        await hnswDb.add('doc-1', 'First version', { id: 'doc-1', category: 'test' });

        await expect(hnswDb.add('doc-1', 'Second version', { id: 'doc-1', category: 'test' })).rejects.toThrow(
          DocumentExistsError,
        );
      });

      test('should require initialization before operations', async () => {
        const uninitDb = new VectoriaDB<TestMetadata>({ useHNSW: true });

        await expect(uninitDb.add('doc-1', 'Test', { id: 'doc-1', category: 'test' })).rejects.toThrow(
          VectoriaNotInitializedError,
        );
      });
    });
  });

  describe('Incremental Updates', () => {
    beforeEach(async () => {
      await db.addMany([
        { id: 'doc-1', text: 'Machine learning basics', metadata: { id: 'doc-1', category: 'tech', author: 'Alice' } },
        { id: 'doc-2', text: 'Cooking pasta recipes', metadata: { id: 'doc-2', category: 'food', author: 'Bob' } },
        { id: 'doc-3', text: 'Python programming', metadata: { id: 'doc-3', category: 'tech', author: 'Charlie' } },
      ]);
    });

    describe('updateMetadata', () => {
      test('should update metadata only without re-embedding', () => {
        const originalDoc = db.get('doc-1')!;
        const originalVector = originalDoc.vector;
        const originalText = originalDoc.text;
        const originalCreatedAt = originalDoc.createdAt;

        db.updateMetadata('doc-1', { id: 'doc-1', category: 'ai', author: 'Alice Updated' });

        const updated = db.get('doc-1')!;
        expect(updated.metadata.category).toBe('ai');
        expect(updated.metadata.author).toBe('Alice Updated');
        expect(updated.text).toBe(originalText);
        expect(updated.vector).toBe(originalVector); // Same reference = not re-embedded
        expect(updated.createdAt).toBe(originalCreatedAt);
      });

      test('should throw error for non-existent document', () => {
        expect(() => {
          db.updateMetadata('non-existent', { id: 'non-existent', category: 'test' });
        }).toThrow(DocumentNotFoundError);
      });

      test('should throw error if not initialized', () => {
        const uninitDb = new VectoriaDB<TestMetadata>();
        expect(() => {
          uninitDb.updateMetadata('doc-1', { id: 'doc-1', category: 'test' });
        }).toThrow('VectoriaDB must be initialized');
      });
    });

    describe('update', () => {
      test('should update metadata only when text not changed', async () => {
        const originalVector = db.get('doc-1')!.vector;

        const reembedded = await db.update('doc-1', {
          metadata: { id: 'doc-1', category: 'ai', author: 'Alice' },
        });

        expect(reembedded).toBe(false); // Not re-embedded
        const updated = db.get('doc-1')!;
        expect(updated.metadata.category).toBe('ai');
        expect(updated.vector).toBe(originalVector);
      });

      test('should re-embed when text changes', async () => {
        const originalVector = db.get('doc-1')!.vector;

        const reembedded = await db.update('doc-1', {
          text: 'Deep learning advanced concepts',
          metadata: { id: 'doc-1', category: 'ai', author: 'Alice' },
        });

        expect(reembedded).toBe(true); // Re-embedded
        const updated = db.get('doc-1')!;
        expect(updated.text).toBe('Deep learning advanced concepts');
        expect(updated.metadata.category).toBe('ai');
        expect(updated.vector).not.toBe(originalVector); // Different reference
      });

      test('should not re-embed when text is same', async () => {
        const originalVector = db.get('doc-1')!.vector;

        const reembedded = await db.update('doc-1', {
          text: 'Machine learning basics', // Same text
          metadata: { id: 'doc-1', category: 'ai', author: 'Alice' },
        });

        expect(reembedded).toBe(false); // Not re-embedded
        const updated = db.get('doc-1')!;
        expect(updated.vector).toBe(originalVector);
        expect(updated.metadata.category).toBe('ai');
      });

      test('should force re-embed when forceReembed is true', async () => {
        const originalVector = db.get('doc-1')!.vector;

        const reembedded = await db.update(
          'doc-1',
          {
            text: 'Machine learning basics', // Same text
          },
          { forceReembed: true },
        );

        expect(reembedded).toBe(true); // Forced re-embedding
        const updated = db.get('doc-1')!;
        expect(updated.vector).not.toBe(originalVector);
      });

      test('should throw error for empty text', async () => {
        await expect(db.update('doc-1', { text: '' })).rejects.toThrow('Document text cannot be empty');
      });

      test('should throw error for whitespace-only text', async () => {
        await expect(db.update('doc-1', { text: '   \n\t  ' })).rejects.toThrow('Document text cannot be empty');
      });

      test('should throw error for non-existent document', async () => {
        await expect(db.update('non-existent', { text: 'New text' })).rejects.toThrow(
          'Document with id "non-existent" not found',
        );
      });

      test('should update text only without metadata', async () => {
        const originalCategory = db.get('doc-1')!.metadata.category;

        await db.update('doc-1', { text: 'New text content' });

        const updated = db.get('doc-1')!;
        expect(updated.text).toBe('New text content');
        expect(updated.metadata.category).toBe(originalCategory); // Unchanged
      });
    });

    describe('updateMany', () => {
      test('should update multiple documents efficiently', async () => {
        const result = await db.updateMany([
          { id: 'doc-1', metadata: { id: 'doc-1', category: 'ai', author: 'Alice' } },
          { id: 'doc-2', metadata: { id: 'doc-2', category: 'recipes', author: 'Bob' } },
        ]);

        expect(result.updated).toBe(2);
        expect(result.reembedded).toBe(0); // Only metadata changed

        expect(db.get('doc-1')!.metadata.category).toBe('ai');
        expect(db.get('doc-2')!.metadata.category).toBe('recipes');
      });

      test('should batch re-embed only documents with text changes', async () => {
        const result = await db.updateMany([
          { id: 'doc-1', text: 'Updated machine learning', metadata: { id: 'doc-1', category: 'ai' } },
          { id: 'doc-2', metadata: { id: 'doc-2', category: 'recipes' } }, // No text change
          { id: 'doc-3', text: 'Updated Python guide', metadata: { id: 'doc-3', category: 'programming' } },
        ]);

        expect(result.updated).toBe(3);
        expect(result.reembedded).toBe(2); // Only doc-1 and doc-3

        expect(db.get('doc-1')!.text).toBe('Updated machine learning');
        expect(db.get('doc-2')!.text).toBe('Cooking pasta recipes'); // Unchanged
        expect(db.get('doc-3')!.text).toBe('Updated Python guide');
      });

      test('should not re-embed when text is same', async () => {
        const result = await db.updateMany([
          { id: 'doc-1', text: 'Machine learning basics', metadata: { id: 'doc-1', category: 'ai' } }, // Same text
        ]);

        expect(result.updated).toBe(1);
        expect(result.reembedded).toBe(0);
      });

      test('should force re-embed all when forceReembed is true', async () => {
        const result = await db.updateMany(
          [
            { id: 'doc-1', text: 'Machine learning basics', metadata: { id: 'doc-1', category: 'ai' } },
            { id: 'doc-2', text: 'Cooking pasta recipes', metadata: { id: 'doc-2', category: 'food' } },
          ],
          { forceReembed: true },
        );

        expect(result.updated).toBe(2);
        expect(result.reembedded).toBe(2); // Both forced to re-embed
      });

      test('should throw error if any document not found', async () => {
        await expect(
          db.updateMany([
            { id: 'doc-1', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'non-existent', metadata: { id: 'non-existent', category: 'test' } },
          ]),
        ).rejects.toThrow('Document with id "non-existent" not found');
      });

      test('should throw error for empty text in batch', async () => {
        await expect(
          db.updateMany([
            { id: 'doc-1', text: 'Valid text', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'doc-2', text: '', metadata: { id: 'doc-2', category: 'test' } },
          ]),
        ).rejects.toThrow('Document with id "doc-2" has empty or whitespace-only text');
      });

      test('should work with HNSW index', async () => {
        const hnswDb = new VectoriaDB<TestMetadata>({ useHNSW: true });
        await hnswDb.initialize();

        await hnswDb.addMany([
          { id: 'doc-1', text: 'Machine learning', metadata: { id: 'doc-1', category: 'tech' } },
          { id: 'doc-2', text: 'Cooking', metadata: { id: 'doc-2', category: 'food' } },
        ]);

        await hnswDb.updateMany([{ id: 'doc-1', text: 'Deep learning AI', metadata: { id: 'doc-1', category: 'ai' } }]);

        const results = await hnswDb.search('artificial intelligence', { threshold: 0 });
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('update performance', () => {
      test('updateMetadata should be instant (no embedding generation)', () => {
        const start = Date.now();
        db.updateMetadata('doc-1', { id: 'doc-1', category: 'updated' });
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(10); // Should be < 10ms
      });

      test('should update metadata on many documents quickly', async () => {
        // Add many documents first
        const docs: Array<{ id: string; text: string; metadata: TestMetadata }> = [];
        for (let i = 0; i < 100; i++) {
          docs.push({ id: `perf-${i}`, text: `Document ${i}`, metadata: { id: `perf-${i}`, category: 'test' } });
        }
        await db.addMany(docs);

        // Metadata-only updates should be fast
        for (let i = 0; i < 100; i++) {
          db.updateMetadata(`perf-${i}`, { id: `perf-${i}`, category: 'updated' });
        }

        expect(db.get('perf-50')!.metadata.category).toBe('updated');
      });
    });
  });
});
