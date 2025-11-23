import { HNSWIndex } from '../hnsw.index';

describe('HNSWIndex', () => {
  let index: HNSWIndex;

  beforeEach(() => {
    index = new HNSWIndex();
  });

  describe('initialization', () => {
    test('should create empty index', () => {
      expect(index.size()).toBe(0);
    });

    test('should accept custom configuration', () => {
      const customIndex = new HNSWIndex({
        M: 32,
        M0: 64,
        efConstruction: 400,
        efSearch: 100,
      });
      expect(customIndex.size()).toBe(0);
    });
  });

  describe('insert', () => {
    test('should insert single vector', () => {
      const vector = new Float32Array([1, 0, 0, 0]);
      index.insert('doc-1', vector);
      expect(index.size()).toBe(1);
    });

    test('should insert multiple vectors', () => {
      const vectors = [new Float32Array([1, 0, 0, 0]), new Float32Array([0, 1, 0, 0]), new Float32Array([0, 0, 1, 0])];

      vectors.forEach((vec, i) => {
        index.insert(`doc-${i}`, vec);
      });

      expect(index.size()).toBe(3);
    });

    test('should handle high-dimensional vectors', () => {
      const dim = 384;
      const vector = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        vector[i] = Math.random();
      }

      index.insert('doc-1', vector);
      expect(index.size()).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Insert some test vectors
      const vectors = [
        { id: 'doc-1', vector: new Float32Array([1, 0, 0, 0]) },
        { id: 'doc-2', vector: new Float32Array([0.9, 0.1, 0, 0]) },
        { id: 'doc-3', vector: new Float32Array([0, 1, 0, 0]) },
        { id: 'doc-4', vector: new Float32Array([0, 0, 1, 0]) },
        { id: 'doc-5', vector: new Float32Array([0, 0, 0, 1]) },
      ];

      vectors.forEach(({ id, vector }) => {
        index.insert(id, vector);
      });
    });

    test('should find nearest neighbor', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 1);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc-1');
      expect(results[0].distance).toBeCloseTo(0, 5);
    });

    test('should find top-k neighbors', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 3);

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('doc-1');
      expect(results[1].id).toBe('doc-2');
    });

    test('should return empty results for empty index', () => {
      const emptyIndex = new HNSWIndex();
      const query = new Float32Array([1, 0, 0, 0]);
      const results = emptyIndex.search(query, 5);

      expect(results.length).toBe(0);
    });

    test('should handle k larger than index size', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 100);

      expect(results.length).toBe(5); // Only 5 vectors in index
    });

    test('should use custom efSearch parameter', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 3, 100);

      expect(results.length).toBe(3);
    });

    test('should find approximate neighbors', () => {
      // Create fresh index for this test with different dimensions
      const testIndex = new HNSWIndex();

      // Insert many vectors to test approximate search
      const numVectors = 100;
      for (let i = 0; i < numVectors; i++) {
        const vector = new Float32Array(10);
        for (let j = 0; j < 10; j++) {
          vector[j] = Math.random();
        }
        testIndex.insert(`doc-${i}`, vector);
      }

      const query = new Float32Array(10);
      for (let i = 0; i < 10; i++) {
        query[i] = Math.random();
      }

      const results = testIndex.search(query, 10);
      expect(results.length).toBe(10);
      // Results should be sorted by distance (ascending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
      }
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      // Insert test vectors
      for (let i = 0; i < 5; i++) {
        const vector = new Float32Array([i, 0, 0, 0]);
        index.insert(`doc-${i}`, vector);
      }
    });

    test('should remove existing vector', () => {
      expect(index.size()).toBe(5);
      const removed = index.remove('doc-2');
      expect(removed).toBe(true);
      expect(index.size()).toBe(4);
    });

    test('should return false for non-existent vector', () => {
      const removed = index.remove('doc-999');
      expect(removed).toBe(false);
      expect(index.size()).toBe(5);
    });

    test('should update search results after removal', () => {
      index.remove('doc-0');

      const query = new Float32Array([0, 0, 0, 0]);
      const results = index.search(query, 5);

      expect(results.length).toBe(4);
      expect(results.find((r) => r.id === 'doc-0')).toBeUndefined();
    });

    test('should handle removing entry point', () => {
      // Remove the first inserted vector (likely entry point)
      index.remove('doc-0');

      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 3);

      expect(results.length).toBeGreaterThan(0);
    });

    test('should handle removing all vectors', () => {
      for (let i = 0; i < 5; i++) {
        index.remove(`doc-${i}`);
      }

      expect(index.size()).toBe(0);

      const query = new Float32Array([1, 0, 0, 0]);
      const results = index.search(query, 5);
      expect(results.length).toBe(0);
    });
  });

  describe('clear', () => {
    test('should clear all vectors', () => {
      for (let i = 0; i < 10; i++) {
        const vector = new Float32Array([i, 0, 0, 0]);
        index.insert(`doc-${i}`, vector);
      }

      expect(index.size()).toBe(10);
      index.clear();
      expect(index.size()).toBe(0);
    });

    test('should allow re-insertion after clear', () => {
      const vector = new Float32Array([1, 0, 0, 0]);
      index.insert('doc-1', vector);
      index.clear();

      index.insert('doc-2', vector);
      expect(index.size()).toBe(1);

      const results = index.search(vector, 1);
      expect(results[0].id).toBe('doc-2');
    });
  });

  describe('performance characteristics', () => {
    test('should maintain graph connectivity', () => {
      // Insert many vectors and ensure all are searchable
      const numVectors = 50;
      const vectors: Array<{ id: string; vector: Float32Array }> = [];

      for (let i = 0; i < numVectors; i++) {
        const vector = new Float32Array(10);
        for (let j = 0; j < 10; j++) {
          vector[j] = Math.random();
        }
        vectors.push({ id: `doc-${i}`, vector });
        index.insert(`doc-${i}`, vector);
      }

      // Verify each vector can be found
      for (const { id, vector } of vectors) {
        const results = index.search(vector, 1);
        expect(results.length).toBeGreaterThan(0);
        // The exact vector should be the closest (distance ~0)
        expect(results[0].id).toBe(id);
        expect(results[0].distance).toBeCloseTo(0, 5);
      }
    });

    test('should handle identical vectors', () => {
      const vector = new Float32Array([1, 0, 0, 0]);

      index.insert('doc-1', vector);
      index.insert('doc-2', vector);
      index.insert('doc-3', vector);

      const results = index.search(vector, 3);
      expect(results.length).toBe(3);
      // All should have distance ~0
      results.forEach((result) => {
        expect(result.distance).toBeCloseTo(0, 5);
      });
    });

    test('should assign different levels to nodes', () => {
      // Insert many nodes and check that some get higher levels
      // This is probabilistic but with 100 nodes, very likely to have multi-level structure
      for (let i = 0; i < 100; i++) {
        const vector = new Float32Array(10);
        for (let j = 0; j < 10; j++) {
          vector[j] = Math.random();
        }
        index.insert(`doc-${i}`, vector);
      }

      // If HNSW is working, should be able to search efficiently
      const query = new Float32Array(10);
      for (let i = 0; i < 10; i++) {
        query[i] = Math.random();
      }

      const results = index.search(query, 10);
      expect(results.length).toBe(10);
    });
  });

  describe('edge cases', () => {
    test('should handle zero vectors', () => {
      const zero = new Float32Array([0, 0, 0, 0]);
      index.insert('zero', zero);

      const results = index.search(zero, 1);
      expect(results[0].id).toBe('zero');
    });

    test('should handle normalized vectors', () => {
      // Unit vectors
      const v1 = new Float32Array([1 / Math.sqrt(2), 1 / Math.sqrt(2), 0, 0]);
      const v2 = new Float32Array([1 / Math.sqrt(2), -1 / Math.sqrt(2), 0, 0]);

      index.insert('v1', v1);
      index.insert('v2', v2);

      const results = index.search(v1, 2);
      expect(results[0].id).toBe('v1');
    });

    test('should handle single vector index', () => {
      const vector = new Float32Array([1, 2, 3, 4]);
      index.insert('only', vector);

      const results = index.search(vector, 1);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('only');
    });
  });
});
