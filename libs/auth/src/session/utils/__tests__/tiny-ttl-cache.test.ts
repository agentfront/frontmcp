/**
 * TinyTtlCache Tests
 */
import { TinyTtlCache } from '../tiny-ttl-cache';

describe('TinyTtlCache', () => {
  let cache: TinyTtlCache<string, string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new TinyTtlCache<string, string>(1000); // 1 second TTL
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get / set', () => {
    it('should round-trip a value', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should return undefined for missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing value', () => {
      cache.set('key', 'first');
      cache.set('key', 'second');
      expect(cache.get('key')).toBe('second');
    });

    it('should handle different value types', () => {
      const numCache = new TinyTtlCache<string, number>(1000);
      numCache.set('count', 42);
      expect(numCache.get('count')).toBe(42);
    });

    it('should handle object values', () => {
      const objCache = new TinyTtlCache<string, { name: string }>(1000);
      const obj = { name: 'test' };
      objCache.set('obj', obj);
      expect(objCache.get('obj')).toBe(obj);
    });
  });

  describe('TTL expiration', () => {
    it('should return value before TTL expires', () => {
      cache.set('key', 'value');
      jest.advanceTimersByTime(999);
      expect(cache.get('key')).toBe('value');
    });

    it('should return undefined after TTL expires', () => {
      cache.set('key', 'value');
      jest.advanceTimersByTime(1001);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should clean up expired entry on get', () => {
      cache.set('key', 'value');
      jest.advanceTimersByTime(1001);
      cache.get('key'); // Triggers cleanup
      // Internal map should no longer have the entry
      expect(cache.size()).toBe(0);
    });

    it('should handle multiple entries with different expiration times', () => {
      cache.set('a', 'val-a');
      jest.advanceTimersByTime(500);
      cache.set('b', 'val-b');
      jest.advanceTimersByTime(600); // 1100ms total for 'a', 600ms for 'b'

      expect(cache.get('a')).toBeUndefined(); // expired
      expect(cache.get('b')).toBe('val-b'); // still valid
    });
  });

  describe('delete', () => {
    it('should remove an existing entry', () => {
      cache.set('key', 'value');
      const result = cache.delete('key');
      expect(result).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      const result = cache.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size()).toBe(0);
    });

    it('should return correct count after insertions', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      expect(cache.size()).toBe(2);
    });

    it('should include expired entries in size (until cleanup)', () => {
      cache.set('a', '1');
      jest.advanceTimersByTime(1001);
      // size() counts internal map entries (including expired)
      expect(cache.size()).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries and return count', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      jest.advanceTimersByTime(1001);
      cache.set('c', '3'); // fresh entry

      const removed = cache.cleanup();
      expect(removed).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.get('c')).toBe('3');
    });

    it('should return 0 when nothing is expired', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      const removed = cache.cleanup();
      expect(removed).toBe(0);
      expect(cache.size()).toBe(2);
    });

    it('should return 0 for empty cache', () => {
      expect(cache.cleanup()).toBe(0);
    });
  });
});
