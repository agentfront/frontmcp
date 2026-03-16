/**
 * Sliding Window Rate Limiter
 *
 * Implements the sliding window counter algorithm for rate limiting.
 * Uses two adjacent fixed-window counters with weighted interpolation
 * to approximate a true sliding window with O(1) storage per check.
 *
 * Built entirely on StorageAdapter interface (incr, mget, expire) —
 * works with Memory, Redis, Vercel KV, Upstash backends.
 */

import type { StorageAdapter } from '@frontmcp/utils';
import type { RateLimitResult } from './types';

export class SlidingWindowRateLimiter {
  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Check whether a request is allowed under the rate limit.
   * If allowed, the counter is atomically incremented.
   */
  async check(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;

    const currentKey = `${key}:${currentWindowStart}`;
    const previousKey = `${key}:${previousWindowStart}`;

    const [currentRaw, previousRaw] = await this.storage.mget([currentKey, previousKey]);
    const currentCount = parseInt(currentRaw ?? '0', 10) || 0;
    const previousCount = parseInt(previousRaw ?? '0', 10) || 0;

    const elapsed = now - currentWindowStart;
    const weight = 1 - elapsed / windowMs;
    const estimatedCount = previousCount * weight + currentCount;

    if (estimatedCount >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: windowMs - elapsed,
        retryAfterMs: windowMs - elapsed,
      };
    }

    await this.storage.incr(currentKey);
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000);
    await this.storage.expire(currentKey, ttlSeconds);

    const remaining = Math.max(0, Math.floor(maxRequests - estimatedCount - 1));

    return {
      allowed: true,
      remaining,
      resetMs: windowMs - elapsed,
    };
  }

  /**
   * Reset the rate limit counters for a key.
   */
  async reset(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;

    await this.storage.mdelete([`${key}:${currentWindowStart}`, `${key}:${previousWindowStart}`]);
  }
}
