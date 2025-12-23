/**
 * Cache Tests
 */

import { TranspileCache, transpileCache, renderCache } from './cache';
import type { TranspileResult } from './types';

describe('TranspileCache', () => {
  let cache: TranspileCache;

  beforeEach(() => {
    cache = new TranspileCache({ maxSize: 5 });
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const defaultCache = new TranspileCache();
      expect(defaultCache).toBeInstanceOf(TranspileCache);
    });

    it('should create cache with custom maxSize', () => {
      const customCache = new TranspileCache({ maxSize: 100 });
      expect(customCache).toBeInstanceOf(TranspileCache);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values by source', () => {
      const source = 'const x = 1;';
      const result: TranspileResult = {
        code: 'var x = 1;',
        hash: 'abc123',
        cached: false,
      };

      cache.set(source, result);
      const retrieved = cache.get(source);

      expect(retrieved).toEqual(result);
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update existing entries', () => {
      const source = 'const x = 1;';
      const result1: TranspileResult = { code: 'v1', hash: 'h1', cached: false };
      const result2: TranspileResult = { code: 'v2', hash: 'h2', cached: false };

      cache.set(source, result1);
      cache.set(source, result2);

      expect(cache.get(source)).toEqual(result2);
    });
  });

  describe('getByKey/setByKey', () => {
    it('should store and retrieve values by explicit key', () => {
      const key = 'custom-key';
      const result: TranspileResult = {
        code: 'var x = 1;',
        hash: 'abc123',
        cached: false,
      };

      cache.setByKey(key, result);
      const retrieved = cache.getByKey(key);

      expect(retrieved).toEqual(result);
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.getByKey('nonexistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing entries', () => {
      const source = 'const x = 1;';
      cache.set(source, { code: 'x', hash: 'h', cached: false });
      expect(cache.has(source)).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove entries', () => {
      const source = 'const x = 1;';
      cache.set(source, { code: 'x', hash: 'h', cached: false });
      expect(cache.has(source)).toBe(true);

      cache.delete(source);
      expect(cache.has(source)).toBe(false);
    });

    it('should handle deleting non-existent entries', () => {
      expect(() => cache.delete('nonexistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('source1', { code: 'a', hash: 'h1', cached: false });
      cache.set('source2', { code: 'b', hash: 'h2', cached: false });

      cache.clear();

      expect(cache.has('source1')).toBe(false);
      expect(cache.has('source2')).toBe(false);
    });

    it('should reset stats after clear', () => {
      cache.set('source1', { code: 'a', hash: 'h1', cached: false });
      cache.get('source1'); // hit

      cache.clear();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when maxSize is exceeded', () => {
      // Cache has maxSize of 5
      for (let i = 0; i < 6; i++) {
        cache.set(`source${i}`, { code: `code${i}`, hash: `h${i}`, cached: false });
      }

      // First entry should be evicted
      expect(cache.has('source0')).toBe(false);
      // Last entries should still exist
      expect(cache.has('source5')).toBe(true);
    });

    it('should update access order on get', () => {
      cache.set('source0', { code: 'code0', hash: 'h0', cached: false });
      cache.set('source1', { code: 'code1', hash: 'h1', cached: false });
      cache.set('source2', { code: 'code2', hash: 'h2', cached: false });

      // Access source0 to make it recently used
      cache.get('source0');

      // Add more entries to trigger eviction
      cache.set('source3', { code: 'code3', hash: 'h3', cached: false });
      cache.set('source4', { code: 'code4', hash: 'h4', cached: false });
      cache.set('source5', { code: 'code5', hash: 'h5', cached: false });

      // source0 was accessed, so source1 should be evicted first
      expect(cache.has('source0')).toBe(true);
      expect(cache.has('source1')).toBe(false);
    });

    it('should not evict existing key when re-setting', () => {
      // Fill cache
      for (let i = 0; i < 5; i++) {
        cache.set(`source${i}`, { code: `code${i}`, hash: `h${i}`, cached: false });
      }

      // Re-set first item (does NOT trigger eviction because key already exists)
      cache.set('source0', { code: 'updated', hash: 'h0', cached: false });

      // Should still have 5 items, no eviction occurred
      const stats = cache.getStats();
      expect(stats.size).toBe(5);
      expect(stats.evictions).toBe(0);

      // All original items should still exist
      for (let i = 0; i < 5; i++) {
        expect(cache.has(`source${i}`)).toBe(true);
      }
    });
  });

  describe('getStats', () => {
    it('should track hits and misses', () => {
      cache.set('source1', { code: 'code1', hash: 'h1', cached: false });

      // Hit
      cache.get('source1');
      // Miss
      cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it('should calculate hit rate', () => {
      cache.set('source1', { code: 'code1', hash: 'h1', cached: false });

      cache.get('source1'); // hit
      cache.get('source1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should return 0 hit rate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should track evictions', () => {
      // Fill cache beyond maxSize
      for (let i = 0; i < 10; i++) {
        cache.set(`source${i}`, { code: `code${i}`, hash: `h${i}`, cached: false });
      }

      const stats = cache.getStats();
      expect(stats.evictions).toBe(5); // 10 - 5 = 5 evictions
    });
  });

  describe('edge cases', () => {
    it('should handle complex object values', () => {
      const result: TranspileResult = {
        code: 'complex',
        hash: 'h1',
        cached: false,
        sourceMap: 'map data',
      };
      cache.set('source', result);
      expect(cache.get('source')).toEqual(result);
    });

    it('should preserve insertion order for LRU', () => {
      // Fill cache
      for (let i = 0; i < 5; i++) {
        cache.set(`source${i}`, { code: `code${i}`, hash: `h${i}`, cached: false });
      }

      // All should exist
      for (let i = 0; i < 5; i++) {
        expect(cache.has(`source${i}`)).toBe(true);
      }
    });
  });
});

describe('Global Cache Instances', () => {
  it('should export transpileCache singleton', () => {
    expect(transpileCache).toBeInstanceOf(TranspileCache);
  });

  it('should export renderCache singleton', () => {
    expect(renderCache).toBeInstanceOf(TranspileCache);
  });

  it('should be different instances', () => {
    expect(transpileCache).not.toBe(renderCache);
  });
});
