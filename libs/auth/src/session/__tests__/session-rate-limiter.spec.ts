/**
 * Session Rate Limiter Tests
 *
 * Tests for sliding window rate limiter: check, wouldAllow, reset,
 * cleanup, getStats, dispose, timer behaviour, and exported singleton.
 */

import { SessionRateLimiter, defaultSessionRateLimiter } from '../session-rate-limiter';

describe('SessionRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Constructor defaults
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should use default windowMs=60000, maxRequests=100', () => {
      const limiter = new SessionRateLimiter();
      // Exercise 100 requests on the same key; all should be allowed
      for (let i = 0; i < 100; i++) {
        expect(limiter.check('k').allowed).toBe(true);
      }
      // 101st should be rejected
      expect(limiter.check('k').allowed).toBe(false);
      limiter.dispose();
    });

    it('should accept custom windowMs and maxRequests', () => {
      const limiter = new SessionRateLimiter({ windowMs: 5000, maxRequests: 3 });

      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('a').allowed).toBe(false);

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // check()
  // -----------------------------------------------------------------------
  describe('check()', () => {
    it('should return allowed=true when under limit with correct remaining', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 5, cleanupIntervalMs: 0 });

      const r1 = limiter.check('ip1');
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(4);
      expect(r1.retryAfterMs).toBeUndefined();

      const r2 = limiter.check('ip1');
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(3);

      limiter.dispose();
    });

    it('should return allowed=false when at limit with retryAfterMs', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 2, windowMs: 10000, cleanupIntervalMs: 0 });

      limiter.check('k');
      limiter.check('k');

      const result = limiter.check('k');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(typeof result.retryAfterMs).toBe('number');
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(10000);

      limiter.dispose();
    });

    it('should track different keys independently', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 1, cleanupIntervalMs: 0 });

      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('a').allowed).toBe(false);
      // different key still has quota
      expect(limiter.check('b').allowed).toBe(true);

      limiter.dispose();
    });

    it('should include resetAt timestamp', () => {
      const limiter = new SessionRateLimiter({ windowMs: 30000, maxRequests: 10, cleanupIntervalMs: 0 });

      const result = limiter.check('x');
      expect(typeof result.resetAt).toBe('number');
      expect(result.resetAt).toBeGreaterThan(Date.now() - 1);

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // wouldAllow()
  // -----------------------------------------------------------------------
  describe('wouldAllow()', () => {
    it('should return true for new key without consuming quota', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 2, cleanupIntervalMs: 0 });

      expect(limiter.wouldAllow('fresh')).toBe(true);
      // still true because no quota consumed
      expect(limiter.wouldAllow('fresh')).toBe(true);

      limiter.dispose();
    });

    it('should return true when under limit without consuming', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 2, cleanupIntervalMs: 0 });

      limiter.check('k'); // consume 1

      expect(limiter.wouldAllow('k')).toBe(true);
      // quota should still be 1, so a real check should succeed
      const result = limiter.check('k');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);

      limiter.dispose();
    });

    it('should return false when at limit', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 1, cleanupIntervalMs: 0 });

      limiter.check('k'); // exhaust quota

      expect(limiter.wouldAllow('k')).toBe(false);

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------
  describe('reset()', () => {
    it('should clear a specific key, allowing requests again', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 1, cleanupIntervalMs: 0 });

      limiter.check('k');
      expect(limiter.check('k').allowed).toBe(false);

      limiter.reset('k');
      expect(limiter.check('k').allowed).toBe(true);

      limiter.dispose();
    });

    it('should not affect other keys', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 1, cleanupIntervalMs: 0 });

      limiter.check('a');
      limiter.check('b');

      limiter.reset('a');

      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('b').allowed).toBe(false);

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // cleanup()
  // -----------------------------------------------------------------------
  describe('cleanup()', () => {
    it('should remove entries where all timestamps are expired', () => {
      const limiter = new SessionRateLimiter({ windowMs: 5000, maxRequests: 10, cleanupIntervalMs: 0 });

      limiter.check('old');

      // Advance past the window
      jest.advanceTimersByTime(6000);

      limiter.cleanup();

      const stats = limiter.getStats();
      expect(stats.totalKeys).toBe(0);
      expect(stats.totalRequests).toBe(0);

      limiter.dispose();
    });

    it('should keep entries with valid timestamps and trim expired ones', () => {
      const limiter = new SessionRateLimiter({ windowMs: 5000, maxRequests: 10, cleanupIntervalMs: 0 });

      limiter.check('k'); // t=0

      jest.advanceTimersByTime(3000);
      limiter.check('k'); // t=3000

      jest.advanceTimersByTime(3000); // t=6000, first request is expired but second is valid

      limiter.cleanup();

      const stats = limiter.getStats();
      expect(stats.totalKeys).toBe(1);
      expect(stats.totalRequests).toBe(1); // only the second request survives
      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // getStats()
  // -----------------------------------------------------------------------
  describe('getStats()', () => {
    it('should return totalKeys and totalRequests', () => {
      const limiter = new SessionRateLimiter({ maxRequests: 10, cleanupIntervalMs: 0 });

      limiter.check('a');
      limiter.check('a');
      limiter.check('b');

      const stats = limiter.getStats();
      expect(stats.totalKeys).toBe(2);
      expect(stats.totalRequests).toBe(3);

      limiter.dispose();
    });

    it('should return zeros when empty', () => {
      const limiter = new SessionRateLimiter({ cleanupIntervalMs: 0 });

      const stats = limiter.getStats();
      expect(stats.totalKeys).toBe(0);
      expect(stats.totalRequests).toBe(0);

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // dispose()
  // -----------------------------------------------------------------------
  describe('dispose()', () => {
    it('should clear all state', () => {
      const limiter = new SessionRateLimiter({ cleanupIntervalMs: 0 });

      limiter.check('a');
      limiter.check('b');

      limiter.dispose();

      expect(limiter.getStats().totalKeys).toBe(0);
      expect(limiter.getStats().totalRequests).toBe(0);
    });

    it('should stop cleanup timer', () => {
      const limiter = new SessionRateLimiter({ cleanupIntervalMs: 1000 });

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      limiter.dispose();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should handle double dispose gracefully', () => {
      const limiter = new SessionRateLimiter({ cleanupIntervalMs: 1000 });

      limiter.dispose();
      // second dispose should not throw
      expect(() => limiter.dispose()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Sliding window expiry
  // -----------------------------------------------------------------------
  describe('sliding window', () => {
    it('should allow requests after old ones expire', () => {
      const limiter = new SessionRateLimiter({ windowMs: 5000, maxRequests: 2, cleanupIntervalMs: 0 });

      limiter.check('k'); // t=0
      limiter.check('k'); // t=0, now at limit

      expect(limiter.check('k').allowed).toBe(false);

      // Advance past window
      jest.advanceTimersByTime(6000);

      // Old requests expired, should be allowed again
      expect(limiter.check('k').allowed).toBe(true);

      limiter.dispose();
    });

    it('should partially expire old requests within the window', () => {
      const limiter = new SessionRateLimiter({ windowMs: 5000, maxRequests: 2, cleanupIntervalMs: 0 });

      limiter.check('k'); // t=0

      jest.advanceTimersByTime(3000);
      limiter.check('k'); // t=3000, now at limit

      expect(limiter.check('k').allowed).toBe(false);

      jest.advanceTimersByTime(3000); // t=6000, first request expired

      // Only 1 valid request remains (t=3000), so one new request should be allowed
      const result = limiter.check('k');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // now at limit again

      limiter.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Automatic cleanup timer
  // -----------------------------------------------------------------------
  describe('automatic cleanup timer', () => {
    it('should run cleanup automatically on interval', () => {
      const limiter = new SessionRateLimiter({
        windowMs: 2000,
        maxRequests: 10,
        cleanupIntervalMs: 3000,
      });

      limiter.check('k');
      expect(limiter.getStats().totalKeys).toBe(1);

      // Advance past window + cleanup interval
      jest.advanceTimersByTime(4000);

      // Cleanup should have run, removing expired entry
      expect(limiter.getStats().totalKeys).toBe(0);

      limiter.dispose();
    });

    it('should not run automatic cleanup when cleanupIntervalMs=0', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const callCountBefore = setIntervalSpy.mock.calls.length;

      const limiter = new SessionRateLimiter({
        windowMs: 2000,
        maxRequests: 10,
        cleanupIntervalMs: 0,
      });

      // No new setInterval should have been called
      expect(setIntervalSpy.mock.calls.length).toBe(callCountBefore);

      limiter.dispose();
      setIntervalSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // defaultSessionRateLimiter singleton
  // -----------------------------------------------------------------------
  describe('defaultSessionRateLimiter', () => {
    it('should be an instance of SessionRateLimiter', () => {
      expect(defaultSessionRateLimiter).toBeInstanceOf(SessionRateLimiter);
    });

    it('should have check method', () => {
      expect(typeof defaultSessionRateLimiter.check).toBe('function');
    });

    it('should have dispose method', () => {
      expect(typeof defaultSessionRateLimiter.dispose).toBe('function');
    });
  });
});
