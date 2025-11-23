import { cosineSimilarity, normalizeVector, euclideanDistance, dotProduct } from '../similarity.utils';

describe('Similarity Utils', () => {
  describe('cosineSimilarity', () => {
    test('should return 1 for identical vectors', () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 3, 4]);

      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    test('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);

      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    test('should return -1 for opposite vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);

      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    test('should handle similar but not identical vectors', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3.1]);

      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.99);
      expect(similarity).toBeLessThan(1.0);
    });

    test('should throw error for vectors of different dimensions', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);

      expect(() => cosineSimilarity(a, b)).toThrow("Vector dimensions don't match");
    });

    test('should return 0 for zero vectors', () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);

      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBe(0);
    });
  });

  describe('normalizeVector', () => {
    test('should normalize a vector to unit length', () => {
      const vector = new Float32Array([3, 4]);
      const normalized = normalizeVector(vector);

      // Length should be 1
      const length = Math.sqrt(normalized[0] * normalized[0] + normalized[1] * normalized[1]);
      expect(length).toBeCloseTo(1.0, 5);

      // Direction should be preserved
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
    });

    test('should handle already normalized vector', () => {
      const vector = new Float32Array([1, 0, 0]);
      const normalized = normalizeVector(vector);

      expect(normalized[0]).toBeCloseTo(1.0, 5);
      expect(normalized[1]).toBeCloseTo(0.0, 5);
      expect(normalized[2]).toBeCloseTo(0.0, 5);
    });

    test('should handle zero vector', () => {
      const vector = new Float32Array([0, 0, 0]);
      const normalized = normalizeVector(vector);

      expect(normalized[0]).toBe(0);
      expect(normalized[1]).toBe(0);
      expect(normalized[2]).toBe(0);
    });
  });

  describe('euclideanDistance', () => {
    test('should calculate distance between identical vectors as 0', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);

      const distance = euclideanDistance(a, b);
      expect(distance).toBeCloseTo(0, 5);
    });

    test('should calculate distance correctly', () => {
      const a = new Float32Array([0, 0]);
      const b = new Float32Array([3, 4]);

      const distance = euclideanDistance(a, b);
      expect(distance).toBeCloseTo(5.0, 5); // 3-4-5 triangle
    });

    test('should throw error for vectors of different dimensions', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);

      expect(() => euclideanDistance(a, b)).toThrow("Vector dimensions don't match");
    });
  });

  describe('dotProduct', () => {
    test('should calculate dot product correctly', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([4, 5, 6]);

      const result = dotProduct(a, b);
      expect(result).toBe(32); // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    });

    test('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);

      const result = dotProduct(a, b);
      expect(result).toBe(0);
    });

    test('should throw error for vectors of different dimensions', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);

      expect(() => dotProduct(a, b)).toThrow("Vector dimensions don't match");
    });
  });
});
