/**
 * Type Cache Adapter Interface
 *
 * Abstract interface for type cache storage implementations.
 * Allows for different backends (memory, Redis, filesystem, etc.).
 *
 * @packageDocumentation
 */

import type { TypeCacheEntry, TypeCacheStats } from '../types';

/**
 * Abstract interface for type cache storage.
 *
 * Implementations must provide:
 * - get/set/has/delete operations
 * - TTL support
 * - Statistics tracking
 *
 * @example Memory cache implementation
 * ```typescript
 * class MemoryTypeCache implements TypeCacheAdapter {
 *   private cache = new Map<string, TypeCacheEntry>();
 *
 *   async get(key: string) {
 *     return this.cache.get(key);
 *   }
 *
 *   async set(key: string, entry: TypeCacheEntry) {
 *     this.cache.set(key, entry);
 *   }
 *   // ...
 * }
 * ```
 *
 * @example Redis cache implementation
 * ```typescript
 * class RedisTypeCache implements TypeCacheAdapter {
 *   constructor(private redis: Redis) {}
 *
 *   async get(key: string) {
 *     const data = await this.redis.get(key);
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   async set(key: string, entry: TypeCacheEntry, ttl?: number) {
 *     const data = JSON.stringify(entry);
 *     if (ttl) {
 *       await this.redis.setex(key, ttl / 1000, data);
 *     } else {
 *       await this.redis.set(key, data);
 *     }
 *   }
 *   // ...
 * }
 * ```
 */
export interface TypeCacheAdapter {
  /**
   * Get a cached entry by key.
   *
   * @param key - Cache key (typically `types:{packageName}@{version}`)
   * @returns The cached entry or undefined if not found/expired
   */
  get(key: string): Promise<TypeCacheEntry | undefined>;

  /**
   * Store an entry in the cache.
   *
   * @param key - Cache key
   * @param entry - Entry to store
   * @param ttl - Optional TTL in milliseconds
   */
  set(key: string, entry: TypeCacheEntry, ttl?: number): Promise<void>;

  /**
   * Check if a key exists in the cache.
   *
   * @param key - Cache key to check
   * @returns true if the key exists and is not expired
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete a cached entry.
   *
   * @param key - Cache key to delete
   * @returns true if the entry was deleted
   */
  delete(key: string): Promise<boolean>;

  /**
   * Clear all cached entries.
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics.
   *
   * @returns Current cache statistics
   */
  getStats(): Promise<TypeCacheStats>;
}

/**
 * Options for cache adapter initialization.
 */
export interface TypeCacheOptions {
  /**
   * Maximum number of entries to store.
   *
   * @default 500
   */
  maxSize?: number;

  /**
   * Default TTL in milliseconds.
   * 0 means infinite TTL.
   *
   * @default 3600000 (1 hour)
   */
  defaultTtl?: number;

  /**
   * Whether to track access statistics.
   *
   * @default true
   */
  trackStats?: boolean;
}

/**
 * Default cache options.
 */
export const DEFAULT_CACHE_OPTIONS: Required<TypeCacheOptions> = {
  maxSize: 500,
  defaultTtl: 60 * 60 * 1000, // 1 hour
  trackStats: true,
};
