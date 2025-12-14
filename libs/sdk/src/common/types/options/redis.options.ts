// common/types/options/redis.options.ts

import { z } from 'zod';

/**
 * Shared Redis configuration
 * Used by transport persistence and auth token storage
 */
export const redisOptionsSchema = z.object({
  /**
   * Redis host
   */
  host: z.string().trim().min(1),

  /**
   * Redis port
   * @default 6379
   */
  port: z.number().int().positive().max(65535).optional().default(6379),

  /**
   * Redis password (optional)
   */
  password: z.string().optional(),

  /**
   * Redis database number
   * @default 0
   */
  db: z.number().int().nonnegative().optional().default(0),

  /**
   * Enable TLS connection
   * @default false
   */
  tls: z.boolean().optional().default(false),

  /**
   * Key prefix for all Redis keys
   * @default 'mcp:'
   */
  keyPrefix: z.string().optional().default('mcp:'),

  /**
   * Default TTL in milliseconds for stored data
   * @default 3600000 (1 hour)
   */
  defaultTtlMs: z.number().int().positive().optional().default(3600000),
});

/**
 * Redis configuration type (with defaults applied)
 */
export type RedisOptions = z.infer<typeof redisOptionsSchema>;

/**
 * Redis configuration input type (for user configuration)
 */
export type RedisOptionsInput = z.input<typeof redisOptionsSchema>;
