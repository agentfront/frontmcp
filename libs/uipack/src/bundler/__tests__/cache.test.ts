/**
 * Bundler Cache Tests
 *
 * Tests for the LRU cache, hash functions, and cache key generation.
 */

import { BundlerCache, hashContent, createCacheKey, type CacheStats } from '../cache';
import type { BundleResult } from '../types';

// ============================================
// Test Fixtures
// ============================================

function createMockResult(overrides: Partial<BundleResult> = {}): BundleResult {
  return {
    code: 'console.log("test");',
    size: 20,
    cached: false,
    hash: 'abc123',
    ...overrides,
  };
}

// ============================================
// BundlerCache Tests
// ============================================

describe('BundlerCache', () => {
  let cache: BundlerCache;

  beforeEach(() => {
    cache = new BundlerCache({ maxSize: 10, ttl: 5000 });
  });

  describe('Constructor', () => {
    it('should create cache with default options', () => {
      const defaultCache = new BundlerCache();
      expect(defaultCache.size).toBe(0);
    });

    it('should create cache with custom options', () => {
      const customCache = new BundlerCache({ maxSize: 50, ttl: 10000 });
      expect(customCache.size).toBe(0);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve entries', () => {
      const result = createMockResult();
      cache.set('key1', result);

      const retrieved = cache.get('key1');
      expect(retrieved).toEqual(result);
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update access count on get', () => {
      const result = createMockResult();
      cache.set('key1', result);

      cache.get('key1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
    });

    it('should track cache misses', () => {
      cache.get('missing1');
      cache.get('missing2');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key1', createMockResult());
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for missing keys', () => {
      expect(cache.has('missing')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing entries', () => {
      cache.set('key1', createMockResult());
      expect(cache.has('key1')).toBe(true);

      const deleted = cache.delete('key1');
      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should return false for missing keys', () => {
      expect(cache.delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', createMockResult());
      cache.set('key2', createMockResult());
      cache.set('key3', createMockResult());

      expect(cache.size).toBe(3);

      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('should reset statistics', () => {
      cache.set('key1', createMockResult());
      cache.get('key1');
      cache.get('missing');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entries when at capacity', () => {
      const smallCache = new BundlerCache({ maxSize: 3, ttl: 60000 });

      smallCache.set('key1', createMockResult({ code: 'code1' }));
      smallCache.set('key2', createMockResult({ code: 'code2' }));
      smallCache.set('key3', createMockResult({ code: 'code3' }));
      smallCache.set('key4', createMockResult({ code: 'code4' }));

      expect(smallCache.size).toBe(3);
      expect(smallCache.has('key1')).toBe(false); // Evicted
      expect(smallCache.has('key2')).toBe(true);
      expect(smallCache.has('key3')).toBe(true);
      expect(smallCache.has('key4')).toBe(true);
    });

    it('should track eviction count', () => {
      const smallCache = new BundlerCache({ maxSize: 2, ttl: 60000 });

      smallCache.set('key1', createMockResult());
      smallCache.set('key2', createMockResult());
      smallCache.set('key3', createMockResult());
      smallCache.set('key4', createMockResult());

      const stats = smallCache.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should refresh LRU order on access', () => {
      const smallCache = new BundlerCache({ maxSize: 3, ttl: 60000 });

      smallCache.set('key1', createMockResult({ code: 'code1' }));
      smallCache.set('key2', createMockResult({ code: 'code2' }));
      smallCache.set('key3', createMockResult({ code: 'code3' }));

      // Access key1, making it most recently used
      smallCache.get('key1');

      // Add key4, should evict key2 (now oldest)
      smallCache.set('key4', createMockResult({ code: 'code4' }));

      expect(smallCache.has('key1')).toBe(true);
      expect(smallCache.has('key2')).toBe(false); // Evicted
      expect(smallCache.has('key3')).toBe(true);
      expect(smallCache.has('key4')).toBe(true);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTtlCache = new BundlerCache({ maxSize: 10, ttl: 50 });

      shortTtlCache.set('key1', createMockResult());
      expect(shortTtlCache.has('key1')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.has('key1')).toBe(false);
      expect(shortTtlCache.get('key1')).toBeUndefined();
    });

    it('should count expired entries as misses', async () => {
      const shortTtlCache = new BundlerCache({ maxSize: 10, ttl: 50 });

      shortTtlCache.set('key1', createMockResult());
      shortTtlCache.get('key1'); // Hit

      await new Promise((resolve) => setTimeout(resolve, 60));

      shortTtlCache.get('key1'); // Miss (expired)

      const stats = shortTtlCache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should track TTL evictions', async () => {
      const shortTtlCache = new BundlerCache({ maxSize: 10, ttl: 50 });

      shortTtlCache.set('key1', createMockResult());

      await new Promise((resolve) => setTimeout(resolve, 60));

      shortTtlCache.get('key1'); // Triggers expiration

      const stats = shortTtlCache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const shortTtlCache = new BundlerCache({ maxSize: 10, ttl: 50 });

      shortTtlCache.set('key1', createMockResult());
      shortTtlCache.set('key2', createMockResult());

      await new Promise((resolve) => setTimeout(resolve, 60));

      const removed = shortTtlCache.cleanup();
      expect(removed).toBe(2);
      expect(shortTtlCache.size).toBe(0);
    });

    it('should not remove non-expired entries', async () => {
      const cache = new BundlerCache({ maxSize: 10, ttl: 10000 });

      cache.set('key1', createMockResult());
      cache.set('key2', createMockResult());

      const removed = cache.cleanup();
      expect(removed).toBe(0);
      expect(cache.size).toBe(2);
    });
  });

  describe('keys', () => {
    it('should return all cache keys', () => {
      cache.set('key1', createMockResult());
      cache.set('key2', createMockResult());
      cache.set('key3', createMockResult());

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return empty array for empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('key1', createMockResult({ size: 100 }));
      cache.set('key2', createMockResult({ size: 200, map: 'sourcemap' }));

      cache.get('key1'); // Hit
      cache.get('key2'); // Hit
      cache.get('missing'); // Miss

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.memoryUsage).toBe(100 + 200 + 'sourcemap'.length);
    });

    it('should return zero hit rate for empty cache', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('size property', () => {
    it('should return correct size', () => {
      expect(cache.size).toBe(0);

      cache.set('key1', createMockResult());
      expect(cache.size).toBe(1);

      cache.set('key2', createMockResult());
      expect(cache.size).toBe(2);

      cache.delete('key1');
      expect(cache.size).toBe(1);
    });
  });
});

// ============================================
// hashContent Tests
// ============================================

describe('hashContent', () => {
  it('should return consistent hash for same content', () => {
    const content = 'const x = 1;';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);

    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different content', () => {
    const hash1 = hashContent('const x = 1;');
    const hash2 = hashContent('const x = 2;');

    expect(hash1).not.toBe(hash2);
  });

  it('should return 8-character hex string', () => {
    const hash = hashContent('test');

    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle empty string', () => {
    const hash = hashContent('');
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle unicode characters', () => {
    const hash = hashContent('日本語テスト');
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle very long content', () => {
    const content = 'x'.repeat(100000);
    const hash = hashContent(content);
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should be sensitive to small changes', () => {
    const hash1 = hashContent('abcdefghijklmnop');
    const hash2 = hashContent('abcdefghijklmnoq');

    expect(hash1).not.toBe(hash2);
  });
});

// ============================================
// createCacheKey Tests
// ============================================

describe('createCacheKey', () => {
  it('should create consistent key for same inputs', () => {
    const options = { sourceType: 'jsx', format: 'esm', minify: true };
    const key1 = createCacheKey('const x = 1;', options);
    const key2 = createCacheKey('const x = 1;', options);

    expect(key1).toBe(key2);
  });

  it('should create different key for different source', () => {
    const options = { sourceType: 'jsx' };
    const key1 = createCacheKey('const x = 1;', options);
    const key2 = createCacheKey('const x = 2;', options);

    expect(key1).not.toBe(key2);
  });

  it('should create different key for different options', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { minify: true });
    const key2 = createCacheKey(source, { minify: false });

    expect(key1).not.toBe(key2);
  });

  it('should include source type in key', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { sourceType: 'jsx' });
    const key2 = createCacheKey(source, { sourceType: 'tsx' });

    expect(key1).not.toBe(key2);
  });

  it('should include format in key', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { format: 'esm' });
    const key2 = createCacheKey(source, { format: 'cjs' });

    expect(key1).not.toBe(key2);
  });

  it('should include target in key', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { target: 'es2020' });
    const key2 = createCacheKey(source, { target: 'es2022' });

    expect(key1).not.toBe(key2);
  });

  it('should include externals in key', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { externals: ['react'] });
    const key2 = createCacheKey(source, { externals: ['vue'] });

    expect(key1).not.toBe(key2);
  });

  it('should sort externals for consistent key', () => {
    const source = 'const x = 1;';
    const key1 = createCacheKey(source, { externals: ['react', 'lodash'] });
    const key2 = createCacheKey(source, { externals: ['lodash', 'react'] });

    expect(key1).toBe(key2);
  });

  it('should return key in format sourceHash-optionsHash', () => {
    const key = createCacheKey('test', { sourceType: 'jsx' });

    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it('should handle empty options', () => {
    const key = createCacheKey('test', {});
    expect(key).toBeDefined();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it('should handle undefined options', () => {
    const key = createCacheKey('test', {
      sourceType: undefined,
      format: undefined,
      minify: undefined,
    });
    expect(key).toBeDefined();
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge Cases', () => {
  it('should handle concurrent access', async () => {
    const cache = new BundlerCache({ maxSize: 100, ttl: 60000 });

    // Simulate concurrent writes
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        cache.set(`key${i}`, createMockResult({ code: `code${i}` }));
      }),
    );

    await Promise.all(promises);

    expect(cache.size).toBe(100);
  });

  it('should handle rapid get/set cycles', () => {
    const cache = new BundlerCache({ maxSize: 5, ttl: 60000 });

    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i % 10}`, createMockResult({ code: `code${i}` }));
      cache.get(`key${i % 10}`);
    }

    expect(cache.size).toBeLessThanOrEqual(5);
  });

  it('should handle special characters in cache keys', () => {
    const cache = new BundlerCache({ maxSize: 10, ttl: 60000 });

    const specialKeys = ['key:with:colons', 'key/with/slashes', 'key\\with\\backslashes', 'key with spaces'];

    specialKeys.forEach((key) => {
      cache.set(key, createMockResult());
      expect(cache.has(key)).toBe(true);
    });
  });
});
