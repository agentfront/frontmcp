/**
 * Bundler Cache
 *
 * LRU cache implementation for bundled results.
 * Provides content-addressable caching with TTL expiration.
 *
 * @packageDocumentation
 */

import type { BundleResult, CacheEntry } from './types';

/**
 * Cache configuration options.
 */
export interface CacheOptions {
  /**
   * Maximum number of entries in the cache.
   * @default 100
   */
  maxSize: number;

  /**
   * Time-to-live for cache entries in milliseconds.
   * @default 300000 (5 minutes)
   */
  ttl: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  /**
   * Number of entries in the cache.
   */
  size: number;

  /**
   * Number of cache hits.
   */
  hits: number;

  /**
   * Number of cache misses.
   */
  misses: number;

  /**
   * Hit rate (0-1).
   */
  hitRate: number;

  /**
   * Number of expired entries removed.
   */
  evictions: number;

  /**
   * Total memory used by cache (approximate).
   */
  memoryUsage: number;
}

/**
 * LRU cache for bundled results.
 *
 * Features:
 * - Content-addressable by hash
 * - TTL-based expiration
 * - LRU eviction when at capacity
 * - Statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new BundlerCache({ maxSize: 100, ttl: 300000 });
 *
 * // Store a result
 * cache.set('abc123', bundleResult);
 *
 * // Retrieve a result
 * const cached = cache.get('abc123');
 * if (cached) {
 *   console.log('Cache hit!', cached);
 * }
 *
 * // Get statistics
 * console.log(cache.getStats());
 * ```
 */
export class BundlerCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly options: CacheOptions;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      maxSize: options.maxSize ?? 100,
      ttl: options.ttl ?? 300000,
    };
  }

  /**
   * Get a cached bundle result.
   *
   * @param key - Cache key (typically content hash)
   * @returns Cached result or undefined if not found/expired
   */
  get(key: string): BundleResult | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }

    // Update access tracking
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    this.stats.hits++;

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.result;
  }

  /**
   * Store a bundle result in the cache.
   *
   * @param key - Cache key (typically content hash)
   * @param result - Bundle result to cache
   */
  set(key: string, result: BundleResult): void {
    // Enforce capacity limit
    while (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    const entry: CacheEntry = {
      result,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists in the cache (and is not expired).
   *
   * @param key - Cache key to check
   * @returns true if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }
    return true;
  }

  /**
   * Delete a specific entry from the cache.
   *
   * @param key - Cache key to delete
   * @returns true if the key was found and deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }

  /**
   * Get cache statistics.
   *
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    let memoryUsage = 0;
    for (const entry of this.cache.values()) {
      memoryUsage += entry.result.size;
      if (entry.result.map) {
        memoryUsage += entry.result.map.length;
      }
    }

    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      evictions: this.stats.evictions,
      memoryUsage,
    };
  }

  /**
   * Remove expired entries from the cache.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }

    this.stats.evictions += removed;
    return removed;
  }

  /**
   * Get all cache keys.
   *
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Check if an entry is expired.
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > this.options.ttl;
  }

  /**
   * Evict the oldest (least recently used) entry.
   */
  private evictOldest(): void {
    // Map maintains insertion order, so first key is oldest
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
}

/**
 * Create a hash from source content.
 *
 * Uses a simple but fast hashing algorithm suitable for cache keys.
 *
 * @param content - Content to hash
 * @returns Hash string
 */
export function hashContent(content: string): string {
  // FNV-1a hash - fast and good distribution
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Create a hash from bundle options.
 *
 * Used to differentiate bundles of the same source with different options.
 *
 * @param source - Source content
 * @param options - Bundle options that affect output
 * @returns Combined hash string
 */
export function createCacheKey(
  source: string,
  options: {
    sourceType?: string;
    format?: string;
    minify?: boolean;
    externals?: string[];
    target?: string;
  },
): string {
  const sourceHash = hashContent(source);
  const optionsHash = hashContent(
    JSON.stringify({
      sourceType: options.sourceType,
      format: options.format,
      minify: options.minify,
      externals: options.externals?.slice().sort(),
      target: options.target,
    }),
  );

  return `${sourceHash}-${optionsHash}`;
}
