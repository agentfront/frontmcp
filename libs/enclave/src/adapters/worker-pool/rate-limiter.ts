/**
 * Rate Limiter
 *
 * Prevents message flooding attacks from worker threads.
 *
 * @packageDocumentation
 */

import { MessageFloodError } from './errors';

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum messages per window */
  maxMessagesPerWindow: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Rate window tracking
 */
interface RateWindow {
  /** Message count in current window */
  count: number;
  /** Window start time */
  windowStart: number;
}

/**
 * Sliding window rate limiter
 *
 * Tracks message rates per slot ID and enforces limits.
 */
export class RateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /**
   * Check if a message from a slot is allowed
   *
   * @param slotId - Worker slot identifier
   * @throws MessageFloodError if rate limit exceeded
   */
  checkLimit(slotId: string): void {
    const now = Date.now();
    let window = this.windows.get(slotId);

    // Create new window or reset if expired
    if (!window || now - window.windowStart >= this.config.windowMs) {
      window = { count: 0, windowStart: now };
      this.windows.set(slotId, window);
    }

    // Increment and check
    window.count++;
    if (window.count > this.config.maxMessagesPerWindow) {
      throw new MessageFloodError(slotId);
    }
  }

  /**
   * Reset the rate limit for a slot
   * Called when a worker is recycled
   *
   * @param slotId - Worker slot identifier
   */
  reset(slotId: string): void {
    this.windows.delete(slotId);
  }

  /**
   * Clear all rate limit tracking
   */
  clear(): void {
    this.windows.clear();
  }

  /**
   * Get current rate for a slot
   *
   * @param slotId - Worker slot identifier
   * @returns Current message count in window, or 0 if no window
   */
  getCurrentRate(slotId: string): number {
    const window = this.windows.get(slotId);
    if (!window) return 0;

    const now = Date.now();
    if (now - window.windowStart >= this.config.windowMs) {
      return 0; // Window expired
    }

    return window.count;
  }

  /**
   * Prune expired windows
   * Should be called periodically to prevent memory leaks
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [slotId, window] of this.windows) {
      if (now - window.windowStart >= this.config.windowMs * 2) {
        this.windows.delete(slotId);
        pruned++;
      }
    }

    return pruned;
  }
}

/**
 * Create a rate limiter from worker pool config
 */
export function createRateLimiter(maxMessagesPerSecond: number): RateLimiter {
  return new RateLimiter({
    maxMessagesPerWindow: maxMessagesPerSecond,
    windowMs: 1000,
  });
}
