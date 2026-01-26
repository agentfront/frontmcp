// file: libs/sdk/src/skill/cache/skill-http-cache.factory.ts

/**
 * Factory for creating skill HTTP cache instances.
 *
 * @module skill/cache/skill-http-cache.factory
 */

import type { FrontMcpLogger } from '../../common/index.js';
import { SkillHttpCache, MemorySkillHttpCache, RedisSkillHttpCache } from './skill-http-cache.js';

/**
 * Redis configuration options for the cache.
 *
 * Supports 'redis' (uses ioredis under the hood) and 'vercel-kv' providers.
 */
export interface SkillHttpCacheRedisOptions {
  /** Redis provider type */
  provider: 'redis' | 'vercel-kv' | '@vercel/kv';
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database number */
  db?: number;
}

/**
 * Options for creating a skill HTTP cache.
 */
export interface SkillHttpCacheOptions {
  /**
   * Redis configuration for distributed caching.
   * If not provided, falls back to memory cache.
   */
  redis?: SkillHttpCacheRedisOptions;

  /**
   * Cache TTL in milliseconds.
   * @default 60000 (1 minute)
   */
  ttlMs?: number;

  /**
   * Key prefix for Redis cache.
   * @default 'frontmcp:skills:cache:'
   */
  keyPrefix?: string;

  /**
   * Optional logger for cache operations.
   */
  logger?: FrontMcpLogger;
}

/**
 * Result of creating a skill HTTP cache.
 */
export interface SkillHttpCacheResult {
  /** The cache instance */
  cache: SkillHttpCache;
  /** The cache type that was created */
  type: 'memory' | 'redis';
}

/**
 * Check if the provider is a Redis provider.
 */
function hasRedisProvider(redis: SkillHttpCacheRedisOptions | undefined): boolean {
  if (!redis?.provider) return false;
  const provider = redis.provider;
  return provider === 'redis' || provider === 'vercel-kv' || provider === '@vercel/kv';
}

/**
 * Create a skill HTTP cache from configuration.
 *
 * If Redis configuration is provided, creates a Redis-backed cache.
 * Otherwise, falls back to an in-memory cache.
 *
 * @param options - Cache configuration
 * @returns Cache instance and type
 *
 * @example Memory cache (default)
 * ```typescript
 * const { cache, type } = await createSkillHttpCache({ ttlMs: 30000 });
 * // type === 'memory'
 * ```
 *
 * @example Redis cache
 * ```typescript
 * const { cache, type } = await createSkillHttpCache({
 *   redis: { provider: 'redis', host: 'localhost', port: 6379 },
 *   ttlMs: 60000,
 * });
 * // type === 'redis'
 * ```
 */
export async function createSkillHttpCache(options: SkillHttpCacheOptions = {}): Promise<SkillHttpCacheResult> {
  const ttlMs = options.ttlMs ?? 60000;
  const keyPrefix = options.keyPrefix ?? 'frontmcp:skills:cache:';
  const logger = options.logger;

  // Check if Redis is configured
  if (hasRedisProvider(options.redis)) {
    try {
      // Lazy-load Redis client factory
      // Note: This assumes a createRedisClient exists in common/redis
      // For now, we'll create a simple client wrapper
      const cache = await createRedisCache(options.redis!, keyPrefix, ttlMs, logger);
      logger?.verbose('Created Redis-backed skill HTTP cache', { keyPrefix, ttlMs });
      return { cache, type: 'redis' };
    } catch (error) {
      logger?.warn('Failed to create Redis cache, falling back to memory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fall back to memory cache
  const cache = new MemorySkillHttpCache(ttlMs);
  logger?.verbose('Created memory-backed skill HTTP cache', { ttlMs });
  return { cache, type: 'memory' };
}

/**
 * Create a Redis-backed cache.
 */
async function createRedisCache(
  redis: SkillHttpCacheRedisOptions,
  keyPrefix: string,
  ttlMs: number,
  logger?: FrontMcpLogger,
): Promise<SkillHttpCache> {
  // Create a Redis client based on provider
  const provider = redis.provider;

  if (provider === 'vercel-kv' || provider === '@vercel/kv') {
    // Lazy-load Vercel KV - use require for CommonJS compatibility
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { kv } = require('@vercel/kv');
    return new RedisSkillHttpCache({
      getClient: async () => kv,
      keyPrefix,
      ttlMs,
    });
  }

  // Use ioredis for 'redis' provider - use require for CommonJS compatibility
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Redis = require('ioredis');
  const client = new Redis({
    host: redis.host ?? 'localhost',
    port: redis.port ?? 6379,
    password: redis.password,
    db: redis.db,
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
  });

  await client.connect();

  return new RedisSkillHttpCache({
    getClient: async () => client,
    keyPrefix,
    ttlMs,
  });
}
