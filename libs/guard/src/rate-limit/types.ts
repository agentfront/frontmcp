/**
 * Rate Limiting Types
 */

import type { PartitionKey } from '../partition-key/types';

/**
 * Rate limiting configuration.
 * Uses sliding window counter algorithm.
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. @default 60_000 */
  windowMs?: number;
  /** Partition key strategy. @default 'global' */
  partitionBy?: PartitionKey;
}

/**
 * Result from a rate limiter check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterMs?: number;
}
