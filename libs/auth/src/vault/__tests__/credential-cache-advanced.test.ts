/**
 * CredentialCache Advanced Tests
 *
 * Advanced test scenarios for the credential cache including
 * concurrent operations, stress testing at maxSize boundary,
 * and stats accuracy across complex operation sequences.
 */

import { CredentialCache } from '../credential-cache';
import type { ResolvedCredential, CredentialScope } from '../auth-providers.types';
import type { Credential } from '../../session';

/**
 * Helper to create a mock ResolvedCredential for testing.
 */
function mockResolved(
  id: string,
  scope: CredentialScope = 'session',
  opts: { expiresAt?: number; isValid?: boolean } = {},
): ResolvedCredential {
  return {
    credential: { type: 'bearer', token: 'tok-' + id, expiresAt: opts.expiresAt } as Credential,
    providerId: id,
    scope,
    isValid: opts.isValid ?? true,
    acquiredAt: Date.now(),
    expiresAt: opts.expiresAt,
  };
}

describe('CredentialCache - Advanced', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------
  // Concurrent get/set operations
  // --------------------------------------------------

  describe('concurrent get/set operations', () => {
    it('should handle rapid get/set cycles on the same key', () => {
      const cache = new CredentialCache();

      for (let i = 0; i < 100; i++) {
        cache.set('key', mockResolved(`version-${i}`));
        const result = cache.get('key');
        expect(result).toBeDefined();
        expect(result!.providerId).toBe(`version-${i}`);
      }

      expect(cache.size).toBe(1);
      expect(cache.getStats().hits).toBe(100);
    });

    it('should handle interleaved set and get on multiple keys', () => {
      const cache = new CredentialCache();
      const keyCount = 50;

      // Set all keys
      for (let i = 0; i < keyCount; i++) {
        cache.set(`key-${i}`, mockResolved(`key-${i}`));
      }

      // Get all keys in reverse order
      for (let i = keyCount - 1; i >= 0; i--) {
        const result = cache.get(`key-${i}`);
        expect(result).toBeDefined();
        expect(result!.providerId).toBe(`key-${i}`);
      }

      expect(cache.size).toBe(keyCount);
      expect(cache.getStats().hits).toBe(keyCount);
      expect(cache.getStats().misses).toBe(0);
    });

    it('should handle alternating set-invalidate-set on the same key', () => {
      const cache = new CredentialCache();

      for (let i = 0; i < 20; i++) {
        cache.set('toggle', mockResolved(`v${i}`));
        expect(cache.has('toggle')).toBe(true);
        cache.invalidate('toggle');
        expect(cache.has('toggle')).toBe(false);
      }

      expect(cache.size).toBe(0);
    });

    it('should handle concurrent set with different TTLs', () => {
      const cache = new CredentialCache();

      cache.set('short', mockResolved('short'), 1000);
      cache.set('medium', mockResolved('medium'), 5000);
      cache.set('long', mockResolved('long'), 10000);
      cache.set('forever', mockResolved('forever'), 0);

      // At 1500ms, only 'short' should be expired
      jest.advanceTimersByTime(1500);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('medium')).toBeDefined();
      expect(cache.get('long')).toBeDefined();
      expect(cache.get('forever')).toBeDefined();

      // At 5500ms, 'medium' should also be expired
      jest.advanceTimersByTime(4000);
      expect(cache.get('medium')).toBeUndefined();
      expect(cache.get('long')).toBeDefined();
      expect(cache.get('forever')).toBeDefined();

      // At 10500ms, 'long' should be expired too
      jest.advanceTimersByTime(5000);
      expect(cache.get('long')).toBeUndefined();
      expect(cache.get('forever')).toBeDefined();
    });
  });

  // --------------------------------------------------
  // Stress tests at maxSize boundary
  // --------------------------------------------------

  describe('stress tests at maxSize boundary', () => {
    it('should handle filling cache exactly to maxSize', () => {
      const maxSize = 50;
      const cache = new CredentialCache(maxSize);

      for (let i = 0; i < maxSize; i++) {
        cache.set(`p${i}`, mockResolved(`p${i}`));
      }

      expect(cache.size).toBe(maxSize);
      expect(cache.getStats().evictions).toBe(0);

      // All entries should be accessible
      for (let i = 0; i < maxSize; i++) {
        expect(cache.has(`p${i}`)).toBe(true);
      }
    });

    it('should evict correctly when exceeding maxSize by many entries', () => {
      const maxSize = 10;
      const totalEntries = 30;
      const cache = new CredentialCache(maxSize);

      for (let i = 0; i < totalEntries; i++) {
        jest.advanceTimersByTime(1); // Ensure distinct cachedAt timestamps
        cache.set(`p${i}`, mockResolved(`p${i}`));
      }

      expect(cache.size).toBe(maxSize);
      // totalEntries - maxSize = 20 evictions
      expect(cache.getStats().evictions).toBe(totalEntries - maxSize);

      // Only the last maxSize entries should remain
      for (let i = 0; i < totalEntries - maxSize; i++) {
        expect(cache.has(`p${i}`)).toBe(false);
      }
      for (let i = totalEntries - maxSize; i < totalEntries; i++) {
        expect(cache.has(`p${i}`)).toBe(true);
      }
    });

    it('should handle maxSize of 1', () => {
      const cache = new CredentialCache(1);

      cache.set('first', mockResolved('first'));
      expect(cache.size).toBe(1);
      expect(cache.has('first')).toBe(true);

      cache.set('second', mockResolved('second'));
      expect(cache.size).toBe(1);
      expect(cache.has('first')).toBe(false);
      expect(cache.has('second')).toBe(true);
    });

    it('should handle updating existing entries at capacity without eviction', () => {
      const maxSize = 3;
      const cache = new CredentialCache(maxSize);

      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));
      cache.set('c', mockResolved('c'));

      // Updating existing keys should not trigger eviction
      cache.set('a', mockResolved('a', 'global'));
      cache.set('b', mockResolved('b', 'user'));
      cache.set('c', mockResolved('c', 'global'));

      expect(cache.size).toBe(3);
      expect(cache.getStats().evictions).toBe(0);
    });

    it('should correctly evict oldest entry in a large cache', () => {
      const maxSize = 100;
      const cache = new CredentialCache(maxSize);

      // Fill cache with distinct timestamps
      for (let i = 0; i < maxSize; i++) {
        jest.advanceTimersByTime(10);
        cache.set(`entry-${i}`, mockResolved(`entry-${i}`));
      }

      // Add one more - should evict entry-0 (oldest cachedAt)
      jest.advanceTimersByTime(10);
      cache.set('overflow', mockResolved('overflow'));

      expect(cache.size).toBe(maxSize);
      expect(cache.has('entry-0')).toBe(false);
      expect(cache.has('entry-1')).toBe(true);
      expect(cache.has('overflow')).toBe(true);
    });
  });

  // --------------------------------------------------
  // Stats accuracy across multiple operations
  // --------------------------------------------------

  describe('stats accuracy', () => {
    it('should accurately track stats across set, get, invalidate sequence', () => {
      const cache = new CredentialCache();

      // Phase 1: Set entries
      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));
      cache.set('c', mockResolved('c'));
      expect(cache.getStats().size).toBe(3);

      // Phase 2: Get operations
      cache.get('a'); // hit
      cache.get('b'); // hit
      cache.get('d'); // miss
      cache.get('e'); // miss

      expect(cache.getStats().hits).toBe(2);
      expect(cache.getStats().misses).toBe(2);

      // Phase 3: Invalidate
      cache.invalidate('a');
      expect(cache.getStats().size).toBe(2);

      // Phase 4: Get invalidated key
      cache.get('a'); // miss
      expect(cache.getStats().misses).toBe(3);
    });

    it('should track evictions from TTL, credential expiry, and maxSize separately', () => {
      const cache = new CredentialCache(3);

      // Add 3 entries - no eviction
      cache.set('ttl-entry', mockResolved('ttl-entry'), 1000);
      jest.advanceTimersByTime(1);
      const futureExpiry = Date.now() + 2000;
      cache.set('cred-entry', mockResolved('cred-entry', 'session', { expiresAt: futureExpiry }));
      jest.advanceTimersByTime(1);
      cache.set('normal', mockResolved('normal'));

      expect(cache.getStats().evictions).toBe(0);

      // Trigger TTL eviction via get
      jest.advanceTimersByTime(1000);
      cache.get('ttl-entry'); // TTL expired -> eviction
      expect(cache.getStats().evictions).toBe(1);

      // Trigger credential expiry via get
      jest.advanceTimersByTime(1000);
      cache.get('cred-entry'); // credential expired -> eviction
      expect(cache.getStats().evictions).toBe(2);
    });

    it('should correctly track stats after resetStats', () => {
      const cache = new CredentialCache();

      cache.set('a', mockResolved('a'));
      cache.get('a'); // hit
      cache.get('miss'); // miss

      cache.resetStats();

      // Stats should be reset but size preserved
      expect(cache.getStats()).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        size: 1,
      });

      // New operations tracked from zero
      cache.get('a'); // hit
      expect(cache.getStats().hits).toBe(1);
    });

    it('should accurately count evictions in cleanup', () => {
      const cache = new CredentialCache();

      cache.set('e1', mockResolved('e1'), 100);
      cache.set('e2', mockResolved('e2'), 200);
      cache.set('e3', mockResolved('e3'), 300);
      cache.set('keeper', mockResolved('keeper'));

      jest.advanceTimersByTime(250);
      cache.cleanup();

      // e1 and e2 expired, e3 not yet
      expect(cache.getStats().evictions).toBe(2);
      expect(cache.getStats().size).toBe(2);
    });

    it('should track stats independently from cache.size property', () => {
      const cache = new CredentialCache();

      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));

      // size property reflects actual Map size
      expect(cache.size).toBe(2);
      // stats.size reflects last known size update
      expect(cache.getStats().size).toBe(2);

      cache.invalidate('a');
      expect(cache.size).toBe(1);
      expect(cache.getStats().size).toBe(1);
    });
  });

  // --------------------------------------------------
  // Mixed scope invalidation and expiry
  // --------------------------------------------------

  describe('mixed scope and expiry interactions', () => {
    it('should handle invalidateByScope followed by cleanup correctly', () => {
      const cache = new CredentialCache();

      cache.set('s1', mockResolved('s1', 'session'), 1000);
      cache.set('s2', mockResolved('s2', 'session'));
      cache.set('g1', mockResolved('g1', 'global'), 500);
      cache.set('u1', mockResolved('u1', 'user'));

      // Invalidate session scope
      cache.invalidateByScope('session');
      expect(cache.size).toBe(2);

      // Advance past g1 TTL and cleanup
      jest.advanceTimersByTime(500);
      cache.cleanup();

      expect(cache.size).toBe(1);
      expect(cache.has('u1')).toBe(true);
    });

    it('should handle invalidateAll resetting everything including stats size', () => {
      const cache = new CredentialCache();

      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));
      cache.get('a'); // hit
      cache.get('miss'); // miss

      cache.invalidateAll();

      expect(cache.size).toBe(0);
      expect(cache.getStats().size).toBe(0);
      // hits and misses are not reset by invalidateAll
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);
    });

    it('should handle multiple TTL expirations at the exact same time', () => {
      const cache = new CredentialCache();

      const now = Date.now();
      cache.set('a', mockResolved('a'), 5000);
      cache.set('b', mockResolved('b'), 5000);
      cache.set('c', mockResolved('c'), 5000);

      jest.advanceTimersByTime(5000);

      // All should expire at the same time
      cache.cleanup();
      expect(cache.size).toBe(0);
      expect(cache.getStats().evictions).toBe(3);
    });

    it('should handle mixed credential expiry and TTL on same entry', () => {
      const cache = new CredentialCache();

      // Credential expires before TTL
      const credExpiry = Date.now() + 2000;
      cache.set('cred-first', mockResolved('cred-first', 'session', { expiresAt: credExpiry }), 5000);

      jest.advanceTimersByTime(2000);
      expect(cache.get('cred-first')).toBeUndefined();

      // TTL expires before credential
      const laterExpiry = Date.now() + 10000;
      cache.set('ttl-first', mockResolved('ttl-first', 'session', { expiresAt: laterExpiry }), 3000);

      jest.advanceTimersByTime(3000);
      expect(cache.get('ttl-first')).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // Edge cases
  // --------------------------------------------------

  describe('edge cases', () => {
    it('should handle keys() calling cleanup and reflecting evictions', () => {
      const cache = new CredentialCache();

      cache.set('alive', mockResolved('alive'));
      cache.set('dying', mockResolved('dying'), 500);

      jest.advanceTimersByTime(500);

      const keys = cache.keys();
      expect(keys).toEqual(['alive']);
      expect(cache.getStats().evictions).toBe(1);
    });

    it('should handle setting the same key with different scopes', () => {
      const cache = new CredentialCache();

      cache.set('provider', mockResolved('provider', 'session'));
      cache.set('provider', mockResolved('provider', 'global'));

      expect(cache.size).toBe(1);
      expect(cache.get('provider')!.scope).toBe('global');
    });

    it('should handle get after invalidateAll', () => {
      const cache = new CredentialCache();

      cache.set('a', mockResolved('a'));
      cache.invalidateAll();

      expect(cache.get('a')).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
    });

    it('should handle has on entry that expires exactly at check time', () => {
      const cache = new CredentialCache();

      // TTL of exactly 1000ms
      cache.set('exact', mockResolved('exact'), 1000);

      // At exactly 1000ms, the entry should be expired (>= check)
      jest.advanceTimersByTime(1000);
      expect(cache.has('exact')).toBe(false);
    });

    it('should handle cleanup on cache with only valid entries', () => {
      const cache = new CredentialCache();

      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));

      cache.cleanup();

      expect(cache.size).toBe(2);
      expect(cache.getStats().evictions).toBe(0);
    });
  });
});
