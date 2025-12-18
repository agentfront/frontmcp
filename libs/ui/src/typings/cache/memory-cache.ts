/**
 * Memory Type Cache Implementation
 *
 * LRU-based in-memory cache for TypeScript type definitions.
 * Provides fast, bounded caching with TTL support.
 *
 * @packageDocumentation
 */

import type { TypeCacheEntry, TypeCacheStats } from '../types';
import type { TypeCacheAdapter, TypeCacheOptions } from './cache-adapter';
import { DEFAULT_CACHE_OPTIONS } from './cache-adapter';

/**
 * Internal cache entry with TTL tracking.
 */
interface InternalEntry {
  /** The cached entry */
  entry: TypeCacheEntry;
  /** Expiration timestamp (0 = never) */
  expiresAt: number;
}

/**
 * LRU-based in-memory cache for TypeScript type definitions.
 *
 * Features:
 * - Content-addressable keys
 * - LRU eviction when max size reached
 * - Optional TTL for time-based expiration
 * - Access statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new MemoryTypeCache({ maxSize: 500, defaultTtl: 3600000 });
 *
 * // Store a type result
 * await cache.set('types:react@18.2.0', {
 *   result: { specifier: 'react', ... },
 *   cachedAt: Date.now(),
 *   size: 12345,
 *   accessCount: 1,
 * });
 *
 * // Retrieve it later
 * const entry = await cache.get('types:react@18.2.0');
 * if (entry) {
 *   console.log('Cache hit!', entry.result.content);
 * }
 * ```
 */
export class MemoryTypeCache implements TypeCacheAdapter {
  private cache = new Map<string, InternalEntry>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private readonly trackStats: boolean;

  /** Cache statistics */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: TypeCacheOptions = {}) {
    const opts = { ...DEFAULT_CACHE_OPTIONS, ...options };
    this.maxSize = opts.maxSize;
    this.defaultTtl = opts.defaultTtl;
    this.trackStats = opts.trackStats;
  }

  /**
   * Get a cached entry by key.
   */
  async get(key: string): Promise<TypeCacheEntry | undefined> {
    const internal = this.cache.get(key);

    if (!internal) {
      if (this.trackStats) this.stats.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (internal.expiresAt > 0 && Date.now() > internal.expiresAt) {
      this.cache.delete(key);
      if (this.trackStats) this.stats.misses++;
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    internal.entry.accessCount++;
    this.cache.set(key, internal);

    if (this.trackStats) this.stats.hits++;
    return internal.entry;
  }

  /**
   * Store an entry in the cache.
   */
  async set(key: string, entry: TypeCacheEntry, ttl?: number): Promise<void> {
    // Enforce size limit with LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry (first in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        if (this.trackStats) this.stats.evictions++;
      }
    }

    const effectiveTtl = ttl ?? this.defaultTtl;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : 0;

    this.cache.set(key, { entry, expiresAt });
  }

  /**
   * Check if a key exists in the cache.
   */
  async has(key: string): Promise<boolean> {
    const internal = this.cache.get(key);
    if (!internal) return false;

    // Check TTL
    if (internal.expiresAt > 0 && Date.now() > internal.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a cached entry.
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<TypeCacheStats> {
    // Calculate total size
    let totalSize = 0;
    for (const { entry } of this.cache.values()) {
      totalSize += entry.size;
    }

    const total = this.stats.hits + this.stats.misses;

    return {
      entries: this.cache.size,
      totalSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get number of evictions.
   */
  get evictions(): number {
    return this.stats.evictions;
  }

  /**
   * Clean up expired entries.
   * Call periodically to free memory from expired entries.
   *
   * @returns Number of entries cleaned up
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, internal] of this.cache.entries()) {
      if (internal.expiresAt > 0 && now > internal.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * Global type cache instance.
 * Shared across all TypeFetcher instances.
 */
export const globalTypeCache = new MemoryTypeCache({
  maxSize: 500,
  defaultTtl: 60 * 60 * 1000, // 1 hour
});
