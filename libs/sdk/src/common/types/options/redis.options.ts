// common/types/options/redis.options.ts

import { z } from 'zod';

// ============================================
// Storage Provider Types
// ============================================

/**
 * Supported storage providers
 */
export const storageProviderSchema = z.enum(['redis', 'vercel-kv']);
export type StorageProvider = z.infer<typeof storageProviderSchema>;

// ============================================
// Common Options (shared between providers)
// ============================================

const commonOptionsSchema = z.object({
  /**
   * Key prefix for all keys
   * @default 'mcp:'
   */
  keyPrefix: z.string().optional().default('mcp:'),

  /**
   * Default TTL in milliseconds for stored data
   * @default 3600000 (1 hour)
   */
  defaultTtlMs: z.number().int().positive().optional().default(3600000),
});

// ============================================
// Redis Provider Configuration
// ============================================

/**
 * Redis-specific connection options
 */
const redisConnectionSchema = z.object({
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
});

/**
 * Full Redis provider configuration
 */
export const redisProviderSchema = z
  .object({
    /**
     * Storage provider type
     * @default 'redis'
     */
    provider: z.literal('redis'),
  })
  .merge(redisConnectionSchema)
  .merge(commonOptionsSchema);

export type RedisProviderOptions = z.infer<typeof redisProviderSchema>;

// ============================================
// Vercel KV Provider Configuration
// ============================================

/**
 * Vercel KV provider configuration
 * Uses environment variables by default (KV_REST_API_URL, KV_REST_API_TOKEN)
 */
export const vercelKvProviderSchema = z
  .object({
    /**
     * Storage provider type
     */
    provider: z.literal('vercel-kv'),

    /**
     * KV REST API URL
     * @default process.env.KV_REST_API_URL
     */
    url: z.string().url().optional(),

    /**
     * KV REST API Token
     * @default process.env.KV_REST_API_TOKEN
     */
    token: z.string().optional(),
  })
  .merge(commonOptionsSchema);

export type VercelKvProviderOptions = z.infer<typeof vercelKvProviderSchema>;

// ============================================
// Legacy Redis Schema (backwards compatibility)
// ============================================

/**
 * Legacy Redis configuration without provider field
 * Automatically transforms to redis provider
 */
const legacyRedisSchema = redisConnectionSchema.merge(commonOptionsSchema).transform((val) => ({
  ...val,
  provider: 'redis' as const,
}));

// ============================================
// Combined Redis Options Schema
// ============================================

/**
 * Shared storage configuration
 * Supports both Redis and Vercel KV providers.
 *
 * @example Redis (explicit provider)
 * ```typescript
 * {
 *   provider: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 * }
 * ```
 *
 * @example Redis (legacy format - backwards compatible)
 * ```typescript
 * {
 *   host: 'localhost',
 *   port: 6379,
 * }
 * ```
 *
 * @example Vercel KV (uses env vars by default)
 * ```typescript
 * {
 *   provider: 'vercel-kv',
 * }
 * ```
 *
 * @example Vercel KV (explicit config)
 * ```typescript
 * {
 *   provider: 'vercel-kv',
 *   url: 'https://my-kv.vercel-storage.com',
 *   token: 'my-token',
 * }
 * ```
 */
export const redisOptionsSchema = z.union([redisProviderSchema, vercelKvProviderSchema, legacyRedisSchema]);

/**
 * Storage configuration type (with defaults applied)
 */
export type RedisOptions = z.infer<typeof redisOptionsSchema>;

/**
 * Storage configuration input type (for user configuration)
 */
export type RedisOptionsInput = z.input<typeof redisOptionsSchema>;

// ============================================
// Pub/Sub Options Schema (Redis-only)
// ============================================

/**
 * Pub/Sub configuration (requires Redis, not compatible with Vercel KV)
 *
 * Use this when you need pub/sub features like resource subscriptions
 * but want to use Vercel KV for sessions/cache.
 *
 * @example Hybrid config
 * ```typescript
 * {
 *   redis: { provider: 'vercel-kv' },  // sessions/cache
 *   pubsub: { host: 'localhost' },      // pub/sub
 * }
 * ```
 */
export const pubsubOptionsSchema = z.union([redisProviderSchema, legacyRedisSchema]);

/**
 * Pub/Sub configuration type (Redis-only)
 */
export type PubsubOptions = z.infer<typeof pubsubOptionsSchema>;

/**
 * Pub/Sub configuration input type
 */
export type PubsubOptionsInput = z.input<typeof pubsubOptionsSchema>;

// ============================================
// Type Guards
// ============================================

/**
 * Check if options are for Redis provider
 */
export function isRedisProvider(options: RedisOptions): options is RedisProviderOptions {
  return options.provider === 'redis';
}

/**
 * Check if options are for Vercel KV provider
 */
export function isVercelKvProvider(options: RedisOptions): options is VercelKvProviderOptions {
  return options.provider === 'vercel-kv';
}

/**
 * Check if pub/sub options are valid Redis config
 */
export function isPubsubConfigured(options: PubsubOptions): options is RedisProviderOptions {
  return options.provider === 'redis';
}
