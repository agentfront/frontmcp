/**
 * Session Rate Limiter
 *
 * Simple sliding window rate limiter for session lookup operations.
 * Protects against session enumeration attacks by limiting the rate
 * of session lookups per client IP or identifier.
 */

export interface SessionRateLimiterConfig {
  /**
   * Time window in milliseconds for rate limiting.
   * @default 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Maximum requests allowed per window per key.
   * @default 100
   */
  maxRequests?: number;

  /**
   * Interval in milliseconds for automatic cleanup of expired entries.
   * Set to 0 to disable automatic cleanup.
   * @default 60000 (1 minute)
   */
  cleanupIntervalMs?: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Timestamp when the rate limit resets (epoch ms) */
  resetAt: number;
  /** Time to wait before retry (only set if not allowed) */
  retryAfterMs?: number;
}

/**
 * Sliding window rate limiter for session operations.
 *
 * Uses an in-memory sliding window algorithm to track request timestamps
 * per key (typically client IP). Automatically cleans up expired entries.
 *
 * @example
 * ```typescript
 * const rateLimiter = new SessionRateLimiter({ maxRequests: 50, windowMs: 60000 });
 *
 * // In session store get()
 * const clientIp = getClientIp(req);
 * const result = rateLimiter.check(clientIp);
 * if (!result.allowed) {
 *   throw new Error(`Rate limit exceeded. Retry after ${result.retryAfterMs}ms`);
 * }
 * ```
 */
export class SessionRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly requests: Map<string, number[]> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: SessionRateLimiterConfig = {}) {
    this.windowMs = config.windowMs ?? 60000;
    this.maxRequests = config.maxRequests ?? 100;

    // Start automatic cleanup if configured
    const cleanupIntervalMs = config.cleanupIntervalMs ?? 60000;
    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
      // Don't block process exit
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a request is allowed for the given key.
   *
   * @param key - Identifier for rate limiting (e.g., client IP, session ID prefix)
   * @returns Rate limit result with allowed status and metadata
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing timestamps or create new array
    let timestamps = this.requests.get(key);
    if (!timestamps) {
      timestamps = [];
      this.requests.set(key, timestamps);
    }

    // Remove expired timestamps (outside window)
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    // Calculate reset time (when oldest entry in window expires)
    const oldestInWindow = validTimestamps[0] ?? now;
    const resetAt = oldestInWindow + this.windowMs;

    // Check if limit exceeded
    if (validTimestamps.length >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: resetAt - now,
      };
    }

    // Add current request timestamp
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetAt,
    };
  }

  /**
   * Check if a request would be allowed without recording it.
   * Useful for pre-checking without consuming quota.
   *
   * @param key - Identifier for rate limiting
   * @returns true if request would be allowed
   */
  wouldAllow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.requests.get(key);

    if (!timestamps) return true;

    const validCount = timestamps.filter((t) => t > windowStart).length;
    return validCount < this.maxRequests;
  }

  /**
   * Reset rate limit for a specific key.
   * Useful for testing or after successful authentication.
   *
   * @param key - Identifier to reset
   */
  reset(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Clean up expired entries from all keys.
   * Called automatically on configured interval, but can be called manually.
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else if (valid.length < timestamps.length) {
        this.requests.set(key, valid);
      }
    }
  }

  /**
   * Get current statistics for monitoring.
   */
  getStats(): { totalKeys: number; totalRequests: number } {
    let totalRequests = 0;
    for (const timestamps of this.requests.values()) {
      totalRequests += timestamps.length;
    }
    return {
      totalKeys: this.requests.size,
      totalRequests,
    };
  }

  /**
   * Stop the automatic cleanup timer.
   * Call this when disposing of the rate limiter.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.requests.clear();
  }
}

/**
 * Default shared rate limiter instance.
 * Use this for simple cases where a single limiter is sufficient.
 */
export const defaultSessionRateLimiter = new SessionRateLimiter();
