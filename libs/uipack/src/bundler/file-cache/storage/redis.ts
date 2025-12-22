/**
 * Redis Build Cache Storage
 *
 * Redis-based cache storage for production environments.
 * Uses Redis TTL for expiration and optional compression.
 *
 * @packageDocumentation
 */

import type { ComponentBuildManifest, CacheStats } from '../../../dependency/types';
import type { BuildCacheStorage, StorageOptions, CacheEntry, CacheEntryMetadata } from './interface';
import { DEFAULT_STORAGE_OPTIONS, calculateManifestSize } from './interface';

/**
 * Redis client interface (compatible with ioredis and redis packages).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  exists(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  quit(): Promise<unknown>;
  ping(): Promise<string>;
}

/**
 * Options specific to Redis storage.
 */
export interface RedisStorageOptions extends StorageOptions {
  /**
   * Redis client instance.
   * Must be provided.
   */
  client: RedisClient;

  /**
   * Key prefix for cache entries.
   * @default 'frontmcp:ui:build:'
   */
  keyPrefix?: string;

  /**
   * Whether to use JSON.stringify/parse (vs raw storage).
   * @default true
   */
  json?: boolean;
}

/**
 * Key for storing cache statistics.
 */
const STATS_KEY_SUFFIX = ':__stats__';

/**
 * Redis-based build cache storage.
 *
 * Stores build manifests in Redis with automatic TTL expiration.
 * Suitable for production environments with multiple server instances.
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const storage = new RedisStorage({
 *   client: redis,
 *   keyPrefix: 'myapp:builds:',
 *   defaultTtl: 3600, // 1 hour
 * });
 *
 * await storage.initialize();
 * await storage.set('abc123', manifest);
 * ```
 */
export class RedisStorage implements BuildCacheStorage {
  readonly type = 'redis';

  private readonly options: Required<Omit<RedisStorageOptions, 'client'>> & { client: RedisClient };
  private initialized = false;
  private localStats: CacheStats = {
    entries: 0,
    totalSize: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
  };

  constructor(options: RedisStorageOptions) {
    if (!options.client) {
      throw new Error('Redis client is required');
    }

    this.options = {
      ...DEFAULT_STORAGE_OPTIONS,
      keyPrefix: 'frontmcp:ui:build:',
      json: true,
      ...options,
    };
  }

  /**
   * Initialize the Redis connection.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Test connection
      await this.options.client.ping();

      // Load stats from Redis
      await this.loadStats();

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }

  /**
   * Get a cached manifest.
   */
  async get(key: string): Promise<ComponentBuildManifest | undefined> {
    this.ensureInitialized();

    const redisKey = this.getRedisKey(key);

    try {
      const data = await this.options.client.get(redisKey);

      if (!data) {
        this.localStats.misses++;
        this.updateHitRate();
        await this.persistStats();
        return undefined;
      }

      // CacheEntry must always be JSON parsed to access metadata structure
      const entry: CacheEntry = JSON.parse(data);

      // Update access metadata
      entry.metadata.lastAccessedAt = Date.now();
      entry.metadata.accessCount++;

      // Get remaining TTL and persist updated entry
      const ttl = await this.options.client.ttl(redisKey);
      if (ttl > 0) {
        // Re-set with same TTL to update metadata
        // CacheEntry must always be JSON serialized to maintain metadata structure
        const serialized = JSON.stringify(entry);
        await this.options.client.setex(redisKey, ttl, serialized);
      }

      this.localStats.hits++;
      this.updateHitRate();
      await this.persistStats();

      return entry.data;
    } catch (error) {
      // Log for debugging but still return undefined for cache miss
      console.warn?.(`Redis cache get failed for key "${key}": ${error}`);
      this.localStats.misses++;
      this.updateHitRate();
      // Persist stats on error path too for consistency
      await this.persistStats().catch(() => {
        /* Ignore stats persistence errors in error path */
      });
      return undefined;
    }
  }

  /**
   * Store a manifest in cache.
   */
  async set(key: string, manifest: ComponentBuildManifest, ttl?: number): Promise<void> {
    this.ensureInitialized();

    const redisKey = this.getRedisKey(key);
    const size = calculateManifestSize(manifest);
    const effectiveTtl = ttl ?? this.options.defaultTtl;

    const entry: CacheEntry = {
      data: manifest,
      metadata: {
        key,
        size,
        createdAt: Date.now(),
        expiresAt: Date.now() + effectiveTtl * 1000,
        lastAccessedAt: Date.now(),
        accessCount: 0,
      },
    };

    // CacheEntry must always be JSON serialized to maintain metadata structure
    const serialized = JSON.stringify(entry);

    await this.options.client.setex(redisKey, effectiveTtl, serialized);

    this.localStats.entries++;
    this.localStats.totalSize += size;
    await this.persistStats();
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    this.ensureInitialized();

    const redisKey = this.getRedisKey(key);
    const exists = await this.options.client.exists(redisKey);
    return exists > 0;
  }

  /**
   * Delete a cached entry.
   */
  async delete(key: string): Promise<boolean> {
    this.ensureInitialized();

    const redisKey = this.getRedisKey(key);

    // Try to get size for stats before deleting
    try {
      const data = await this.options.client.get(redisKey);
      if (data) {
        // CacheEntry must always be JSON parsed to access metadata structure
        const entry: CacheEntry = JSON.parse(data);
        this.localStats.totalSize = Math.max(0, this.localStats.totalSize - entry.metadata.size);
      }
    } catch {
      // Ignore errors
    }

    const deleted = await this.options.client.del(redisKey);

    if (deleted > 0) {
      this.localStats.entries = Math.max(0, this.localStats.entries - 1);
      await this.persistStats();
      return true;
    }

    return false;
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    const pattern = `${this.options.keyPrefix}*`;
    const keys = await this.options.client.keys(pattern);

    if (keys.length > 0) {
      await this.options.client.del(keys);
    }

    this.localStats = {
      entries: 0,
      totalSize: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
    };

    await this.persistStats();
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    await this.loadStats();
    return { ...this.localStats };
  }

  /**
   * Clean up expired entries.
   * Redis handles TTL expiration automatically, so this just refreshes stats.
   */
  async cleanup(): Promise<number> {
    this.ensureInitialized();

    // Count actual keys
    const pattern = `${this.options.keyPrefix}*`;
    const keys = await this.options.client.keys(pattern);

    // Filter out stats key
    const dataKeys = keys.filter((k) => !k.endsWith(STATS_KEY_SUFFIX));
    const previousCount = this.localStats.entries;

    this.localStats.entries = dataKeys.length;

    // Recalculate total size (expensive, but accurate)
    let totalSize = 0;
    for (const key of dataKeys) {
      try {
        const data = await this.options.client.get(key);
        if (data) {
          // CacheEntry must always be JSON parsed to access metadata structure
          const entry: CacheEntry = JSON.parse(data);
          totalSize += entry.metadata.size;
        }
      } catch {
        // Skip corrupted entries
      }
    }

    this.localStats.totalSize = totalSize;
    await this.persistStats();

    return Math.max(0, previousCount - this.localStats.entries);
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    await this.options.client.quit();
  }

  /**
   * Get the Redis key for a cache key.
   */
  private getRedisKey(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  /**
   * Get the Redis key for stats.
   */
  private getStatsKey(): string {
    return `${this.options.keyPrefix}${STATS_KEY_SUFFIX}`;
  }

  /**
   * Ensure the storage is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  /**
   * Load stats from Redis.
   */
  private async loadStats(): Promise<void> {
    try {
      const statsKey = this.getStatsKey();
      const data = await this.options.client.get(statsKey);

      if (data) {
        const savedStats = JSON.parse(data);
        this.localStats = {
          ...this.localStats,
          ...savedStats,
        };
      }
    } catch {
      // Use default stats
    }
  }

  /**
   * Persist stats to Redis.
   */
  private async persistStats(): Promise<void> {
    try {
      const statsKey = this.getStatsKey();
      const serialized = JSON.stringify(this.localStats);
      // Stats don't expire
      await this.options.client.set(statsKey, serialized);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Update hit rate statistic.
   */
  private updateHitRate(): void {
    const total = this.localStats.hits + this.localStats.misses;
    this.localStats.hitRate = total > 0 ? this.localStats.hits / total : 0;
  }
}

/**
 * Create a Redis storage instance.
 */
export function createRedisStorage(options: RedisStorageOptions): RedisStorage {
  return new RedisStorage(options);
}
