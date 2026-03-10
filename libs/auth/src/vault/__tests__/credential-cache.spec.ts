/**
 * CredentialCache Tests
 *
 * Tests for the in-memory credential cache with TTL support,
 * eviction policies, and cache statistics tracking.
 */

import { CredentialCache } from '../credential-cache';
import type { ResolvedCredential, CredentialScope } from '../auth-providers.types';
import type { Credential } from '../../session';
import { assertDefined } from '../../__test-utils__/assertion.helpers';

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

describe('CredentialCache', () => {
  let cache: CredentialCache;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000000);
    cache = new CredentialCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------
  // Constructor
  // --------------------------------------------------

  describe('constructor', () => {
    it('should create a cache with default maxSize of 100', () => {
      const c = new CredentialCache();
      expect(c.size).toBe(0);
    });

    it('should create a cache with custom maxSize', () => {
      const c = new CredentialCache(5);
      // Fill to capacity - no eviction yet
      for (let i = 0; i < 5; i++) {
        c.set(`p${i}`, mockResolved(`p${i}`));
      }
      expect(c.size).toBe(5);
    });
  });

  // --------------------------------------------------
  // get
  // --------------------------------------------------

  describe('get', () => {
    it('should return undefined for a missing entry and increment misses', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
    });

    it('should return the cached entry and increment hits', () => {
      const resolved = mockResolved('github');
      cache.set('github', resolved);

      const result = cache.get('github');
      assertDefined(result);
      expect(result.providerId).toBe('github');
      expect(result.credential).toEqual(resolved.credential);
      expect(cache.getStats().hits).toBe(1);
    });

    it('should return undefined when TTL has expired', () => {
      const resolved = mockResolved('github');
      cache.set('github', resolved, 5000); // 5 second TTL

      // Still valid at 4999ms
      jest.advanceTimersByTime(4999);
      expect(cache.get('github')).toBeDefined();

      // Expired at 5000ms
      jest.advanceTimersByTime(1);
      const result = cache.get('github');
      expect(result).toBeUndefined();
      expect(cache.getStats().evictions).toBe(1);
    });

    it('should return undefined when credential expiresAt has passed', () => {
      const futureExpiry = Date.now() + 3000;
      const resolved = mockResolved('openai', 'session', { expiresAt: futureExpiry });
      cache.set('openai', resolved);

      // Still valid before expiry
      jest.advanceTimersByTime(2999);
      expect(cache.get('openai')).toBeDefined();

      // Expired at expiresAt
      jest.advanceTimersByTime(1);
      const result = cache.get('openai');
      expect(result).toBeUndefined();
    });

    it('should return undefined when isValid is false', () => {
      const resolved = mockResolved('invalid-prov', 'session', { isValid: false });
      cache.set('invalid-prov', resolved);

      // The entry is stored, but isExpiredAt checks isValid
      const result = cache.get('invalid-prov');
      expect(result).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
      expect(cache.getStats().evictions).toBe(1);
    });

    it('should count expired TTL retrieval as a miss and eviction', () => {
      cache.set('p1', mockResolved('p1'), 1000);
      jest.advanceTimersByTime(1000);

      cache.get('p1');
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.evictions).toBe(1);
    });
  });

  // --------------------------------------------------
  // set / get round-trip
  // --------------------------------------------------

  describe('set/get round-trip', () => {
    it('should store and retrieve multiple providers', () => {
      const r1 = mockResolved('github', 'user');
      const r2 = mockResolved('openai', 'global');
      const r3 = mockResolved('aws', 'session');

      cache.set('github', r1);
      cache.set('openai', r2);
      cache.set('aws', r3);

      const github = cache.get('github');
      assertDefined(github);
      expect(github.providerId).toBe('github');
      const openai = cache.get('openai');
      assertDefined(openai);
      expect(openai.scope).toBe('global');
      const aws = cache.get('aws');
      assertDefined(aws);
      expect(aws.scope).toBe('session');
      expect(cache.size).toBe(3);
    });

    it('should overwrite an existing entry with the same key', () => {
      const original = mockResolved('github');
      const replacement = mockResolved('github', 'global');

      cache.set('github', original);
      cache.set('github', replacement);

      expect(cache.size).toBe(1);
      const retrieved = cache.get('github');
      assertDefined(retrieved);
      expect(retrieved.scope).toBe('global');
    });

    it('should store entry with zero TTL (no TTL expiration)', () => {
      cache.set('p1', mockResolved('p1'), 0);

      // Advance time significantly - should still be valid (no TTL)
      jest.advanceTimersByTime(999999999);
      expect(cache.get('p1')).toBeDefined();
    });
  });

  // --------------------------------------------------
  // has
  // --------------------------------------------------

  describe('has', () => {
    it('should return true for a cached entry', () => {
      cache.set('p1', mockResolved('p1'));
      expect(cache.has('p1')).toBe(true);
    });

    it('should return false for a missing entry', () => {
      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for an expired entry and evict it', () => {
      cache.set('p1', mockResolved('p1'), 1000);
      jest.advanceTimersByTime(1000);

      expect(cache.has('p1')).toBe(false);
      expect(cache.size).toBe(0);
      expect(cache.getStats().evictions).toBe(1);
    });

    it('should return false for an entry with isValid=false', () => {
      cache.set('p1', mockResolved('p1', 'session', { isValid: false }));
      expect(cache.has('p1')).toBe(false);
    });
  });

  // --------------------------------------------------
  // invalidate
  // --------------------------------------------------

  describe('invalidate', () => {
    it('should remove an existing entry and return true', () => {
      cache.set('p1', mockResolved('p1'));
      expect(cache.invalidate('p1')).toBe(true);
      expect(cache.size).toBe(0);
      expect(cache.get('p1')).toBeUndefined();
    });

    it('should return false when entry does not exist', () => {
      expect(cache.invalidate('nonexistent')).toBe(false);
    });

    it('should update stats.size after invalidation', () => {
      cache.set('p1', mockResolved('p1'));
      cache.set('p2', mockResolved('p2'));
      cache.invalidate('p1');

      expect(cache.getStats().size).toBe(1);
    });
  });

  // --------------------------------------------------
  // invalidateAll
  // --------------------------------------------------

  describe('invalidateAll', () => {
    it('should clear all entries', () => {
      cache.set('p1', mockResolved('p1'));
      cache.set('p2', mockResolved('p2'));
      cache.set('p3', mockResolved('p3'));

      cache.invalidateAll();

      expect(cache.size).toBe(0);
      expect(cache.get('p1')).toBeUndefined();
      expect(cache.get('p2')).toBeUndefined();
      expect(cache.get('p3')).toBeUndefined();
    });

    it('should set stats.size to 0', () => {
      cache.set('p1', mockResolved('p1'));
      cache.invalidateAll();
      expect(cache.getStats().size).toBe(0);
    });

    it('should be safe to call on an empty cache', () => {
      cache.invalidateAll();
      expect(cache.size).toBe(0);
    });
  });

  // --------------------------------------------------
  // invalidateByScope
  // --------------------------------------------------

  describe('invalidateByScope', () => {
    it('should remove only entries matching the given scope', () => {
      cache.set('sess1', mockResolved('sess1', 'session'));
      cache.set('sess2', mockResolved('sess2', 'session'));
      cache.set('global1', mockResolved('global1', 'global'));
      cache.set('user1', mockResolved('user1', 'user'));

      cache.invalidateByScope('session');

      expect(cache.size).toBe(2);
      expect(cache.has('sess1')).toBe(false);
      expect(cache.has('sess2')).toBe(false);
      expect(cache.has('global1')).toBe(true);
      expect(cache.has('user1')).toBe(true);
    });

    it('should do nothing when no entries match the scope', () => {
      cache.set('p1', mockResolved('p1', 'global'));
      cache.invalidateByScope('session');
      expect(cache.size).toBe(1);
    });

    it('should update stats.size after scope-based invalidation', () => {
      cache.set('u1', mockResolved('u1', 'user'));
      cache.set('u2', mockResolved('u2', 'user'));
      cache.set('g1', mockResolved('g1', 'global'));

      cache.invalidateByScope('user');
      expect(cache.getStats().size).toBe(1);
    });
  });

  // --------------------------------------------------
  // Eviction at maxSize
  // --------------------------------------------------

  describe('eviction at maxSize', () => {
    it('should evict the oldest entry when cache is at capacity', () => {
      const smallCache = new CredentialCache(3);

      smallCache.set('first', mockResolved('first'));
      jest.advanceTimersByTime(1);
      smallCache.set('second', mockResolved('second'));
      jest.advanceTimersByTime(1);
      smallCache.set('third', mockResolved('third'));
      jest.advanceTimersByTime(1);

      // Adding a 4th entry should evict 'first' (the oldest)
      smallCache.set('fourth', mockResolved('fourth'));

      expect(smallCache.size).toBe(3);
      expect(smallCache.has('first')).toBe(false);
      expect(smallCache.has('second')).toBe(true);
      expect(smallCache.has('third')).toBe(true);
      expect(smallCache.has('fourth')).toBe(true);
    });

    it('should not evict when updating an existing key at capacity', () => {
      const smallCache = new CredentialCache(2);

      smallCache.set('a', mockResolved('a'));
      jest.advanceTimersByTime(1);
      smallCache.set('b', mockResolved('b'));

      // Update 'a' - should not evict since key already exists
      smallCache.set('a', mockResolved('a', 'global'));

      expect(smallCache.size).toBe(2);
      expect(smallCache.has('a')).toBe(true);
      expect(smallCache.has('b')).toBe(true);
    });

    it('should increment evictions stat when evicting', () => {
      const smallCache = new CredentialCache(1);
      smallCache.set('a', mockResolved('a'));
      smallCache.set('b', mockResolved('b'));

      expect(smallCache.getStats().evictions).toBe(1);
    });
  });

  // --------------------------------------------------
  // keys
  // --------------------------------------------------

  describe('keys', () => {
    it('should return all non-expired keys', () => {
      cache.set('p1', mockResolved('p1'));
      cache.set('p2', mockResolved('p2'));

      const keys = cache.keys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('p1');
      expect(keys).toContain('p2');
    });

    it('should filter out expired entries', () => {
      cache.set('active', mockResolved('active'));
      cache.set('expiring', mockResolved('expiring'), 1000);

      jest.advanceTimersByTime(1000);

      const keys = cache.keys();
      expect(keys).toEqual(['active']);
    });

    it('should return an empty array for an empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  // --------------------------------------------------
  // size
  // --------------------------------------------------

  describe('size', () => {
    it('should return 0 for an empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('should reflect the current number of entries', () => {
      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));
      expect(cache.size).toBe(2);

      cache.invalidate('a');
      expect(cache.size).toBe(1);
    });
  });

  // --------------------------------------------------
  // getStats / resetStats
  // --------------------------------------------------

  describe('getStats', () => {
    it('should return initial stats with all zeros', () => {
      const stats = cache.getStats();
      expect(stats).toEqual({ hits: 0, misses: 0, evictions: 0, size: 0 });
    });

    it('should track hits and misses accurately', () => {
      cache.set('p1', mockResolved('p1'));

      cache.get('p1'); // hit
      cache.get('p1'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should return a copy, not a reference', () => {
      const stats1 = cache.getStats();
      cache.get('miss');
      const stats2 = cache.getStats();

      expect(stats1.misses).toBe(0);
      expect(stats2.misses).toBe(1);
    });

    it('should track size after set operations', () => {
      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));

      expect(cache.getStats().size).toBe(2);
    });
  });

  describe('resetStats', () => {
    it('should reset hits, misses, and evictions to zero', () => {
      cache.set('p1', mockResolved('p1'));
      cache.get('p1');
      cache.get('missing');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
    });

    it('should preserve current size in stats after reset', () => {
      cache.set('a', mockResolved('a'));
      cache.set('b', mockResolved('b'));

      cache.resetStats();

      expect(cache.getStats().size).toBe(2);
    });
  });

  // --------------------------------------------------
  // cleanup
  // --------------------------------------------------

  describe('cleanup', () => {
    it('should remove all expired entries', () => {
      cache.set('active', mockResolved('active'));
      cache.set('exp1', mockResolved('exp1'), 1000);
      cache.set('exp2', mockResolved('exp2'), 2000);

      jest.advanceTimersByTime(1500);

      cache.cleanup();

      expect(cache.size).toBe(2); // 'active' (no TTL) + 'exp2' (ttl not reached)
      expect(cache.has('active')).toBe(true);
      expect(cache.has('exp2')).toBe(true);
    });

    it('should remove entries with expired credentials', () => {
      const futureExpiry = Date.now() + 2000;
      cache.set('cred-exp', mockResolved('cred-exp', 'session', { expiresAt: futureExpiry }));
      cache.set('no-exp', mockResolved('no-exp'));

      jest.advanceTimersByTime(2000);

      cache.cleanup();

      expect(cache.size).toBe(1);
      expect(cache.has('no-exp')).toBe(true);
    });

    it('should remove entries with isValid=false', () => {
      cache.set('invalid', mockResolved('invalid', 'session', { isValid: false }));
      cache.set('valid', mockResolved('valid'));

      cache.cleanup();

      expect(cache.size).toBe(1);
      expect(cache.has('valid')).toBe(true);
    });

    it('should increment evictions for each cleaned up entry', () => {
      cache.set('e1', mockResolved('e1'), 100);
      cache.set('e2', mockResolved('e2'), 100);

      jest.advanceTimersByTime(100);
      cache.cleanup();

      expect(cache.getStats().evictions).toBe(2);
    });

    it('should update stats.size after cleanup', () => {
      cache.set('a', mockResolved('a'), 500);
      cache.set('b', mockResolved('b'));

      jest.advanceTimersByTime(500);
      cache.cleanup();

      expect(cache.getStats().size).toBe(1);
    });

    it('should be safe to call on an empty cache', () => {
      cache.cleanup();
      expect(cache.size).toBe(0);
    });
  });
});
