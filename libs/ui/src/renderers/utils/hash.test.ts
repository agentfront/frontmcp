/**
 * Hash Utilities Tests
 */

import { hashString, hashCombined, isHash } from './hash';

describe('Hash Utilities', () => {
  describe('hashString', () => {
    it('should return consistent hash for same input', () => {
      const input = 'hello world';
      const hash1 = hashString(input);
      const hash2 = hashString(input);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = hashString('hello');
      const hash2 = hashString('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should return a string hash', () => {
      const hash = hashString('test');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const hash = hashString('');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters', () => {
      const hash1 = hashString('Hello 世界');
      const hash2 = hashString('Hello 世界');
      expect(hash1).toBe(hash2);
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(10000);
      const hash = hashString(longString);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should produce different hashes for similar strings', () => {
      const hash1 = hashString('test1');
      const hash2 = hashString('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('hashCombined', () => {
    it('should combine multiple values into a hash', () => {
      const hash = hashCombined('a', 'b', 'c');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should return consistent hash for same inputs', () => {
      const hash1 = hashCombined('a', 1, true);
      const hash2 = hashCombined('a', 1, true);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = hashCombined('a', 'b');
      const hash2 = hashCombined('b', 'a');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle objects', () => {
      const hash1 = hashCombined({ key: 'value' });
      const hash2 = hashCombined({ key: 'value' });
      expect(hash1).toBe(hash2);
    });

    it('should handle arrays', () => {
      const hash1 = hashCombined([1, 2, 3]);
      const hash2 = hashCombined([1, 2, 3]);
      expect(hash1).toBe(hash2);
    });

    it('should handle null and undefined', () => {
      const hash1 = hashCombined(null, undefined);
      const hash2 = hashCombined(null, undefined);
      expect(hash1).toBe(hash2);
    });

    it('should handle single value', () => {
      const hash = hashCombined('single');
      expect(typeof hash).toBe('string');
    });

    it('should handle no values', () => {
      const hash = hashCombined();
      expect(typeof hash).toBe('string');
    });
  });

  describe('isHash', () => {
    it('should return true for valid hash format', () => {
      const hash = hashString('test');
      expect(isHash(hash)).toBe(true);
    });

    it('should return false for non-hash strings', () => {
      expect(isHash('not-a-hash')).toBe(false);
      expect(isHash('')).toBe(false);
      expect(isHash('hello world')).toBe(false);
    });

    it('should return true for short alphanumeric strings (hash-like)', () => {
      expect(isHash('abc123')).toBe(true);
      expect(isHash('12345678')).toBe(true);
    });

    it('should return false for strings that are too short or too long', () => {
      expect(isHash('abc')).toBe(false); // too short
      expect(isHash('abcdefghijklmnop')).toBe(false); // too long
    });
  });
});
