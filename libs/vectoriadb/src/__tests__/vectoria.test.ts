import { VectoriaDB } from '../vectoria';
import { DocumentMetadata } from '../interfaces';

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

    test('should overwrite existing document with same id', async () => {
      await db.add('doc-1', 'First version', {
        id: 'doc-1',
        category: 'test',
      });

      await db.add('doc-1', 'Second version', {
        id: 'doc-1',
        category: 'updated',
      });

      expect(db.size()).toBe(1);
      const doc = db.get('doc-1');
      expect(doc?.text).toBe('Second version');
      expect(doc?.metadata.category).toBe('updated');
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
});
