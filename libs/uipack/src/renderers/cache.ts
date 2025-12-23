/**
 * LRU Cache for Renderer Transpilation Results
 *
 * Provides fast, memory-bounded caching for transpiled templates.
 * Uses content-addressable keys (hash of source) for deduplication.
 */

import { hashString } from './utils/hash';
import type { TranspileResult } from './types';

/**
 * Cache entry with metadata.
 */
interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Number of times this entry was accessed */
  accessCount: number;
}

/**
 * Options for the transpile cache.
 */
export interface TranspileCacheOptions {
  /** Maximum number of entries (default: 500) */
  maxSize?: number;
  /** TTL in milliseconds, 0 = infinite (default: 0 for transpile cache) */
  ttl?: number;
}

/**
 * LRU Cache for transpiled template results.
 *
 * Features:
 * - Content-addressable keys via hash
 * - LRU eviction when max size reached
 * - Optional TTL for time-based expiration
 * - Access statistics
 *
 * @example
 * ```typescript
 * const cache = new TranspileCache({ maxSize: 500 });
 *
 * // Store a transpiled result
 * const hash = cache.set(sourceCode, transpileResult);
 *
 * // Retrieve it later
 * const result = cache.get(sourceCode);
 * if (result) {
 *   console.log('Cache hit!', result.code);
 * }
 * ```
 */
export class TranspileCache {
  private cache = new Map<string, CacheEntry<TranspileResult>>();
  private readonly maxSize: number;
  private readonly ttl: number;

  /** Cache statistics */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: TranspileCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 500;
    this.ttl = options.ttl ?? 0; // 0 = infinite TTL
  }

  /**
   * Get a cached transpile result by source content.
   *
   * @param source - Source code to look up
   * @returns Cached result or undefined if not found/expired
   */
  get(source: string): TranspileResult | undefined {
    const key = hashString(source);
    return this.getByKey(key);
  }

  /**
   * Get a cached transpile result by hash key.
   *
   * @param key - Hash key
   * @returns Cached result or undefined if not found/expired
   */
  getByKey(key: string): TranspileResult | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.ttl > 0 && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    entry.accessCount++;
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Store a transpile result.
   *
   * @param source - Source code (used to generate key)
   * @param value - Transpile result to cache
   * @returns The hash key used for storage
   */
  set(source: string, value: TranspileResult): string {
    const key = hashString(source);
    this.setByKey(key, value);
    return key;
  }

  /**
   * Store a transpile result by hash key.
   *
   * @param key - Hash key
   * @param value - Transpile result to cache
   */
  setByKey(key: string, value: TranspileResult): void {
    // Enforce size limit with LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry (first in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * Check if a source is cached.
   *
   * @param source - Source code to check
   * @returns True if cached and not expired
   */
  has(source: string): boolean {
    const key = hashString(source);
    return this.hasByKey(key);
  }

  /**
   * Check if a key is cached.
   *
   * @param key - Hash key to check
   * @returns True if cached and not expired
   */
  hasByKey(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (this.ttl > 0 && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a cached entry by source.
   *
   * @param source - Source code to delete
   * @returns True if entry was deleted
   */
  delete(source: string): boolean {
    const key = hashString(source);
    return this.cache.delete(key);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; evictions: number; size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

/**
 * Global transpile cache instance.
 * Shared across all renderers for deduplication.
 */
export const transpileCache = new TranspileCache({ maxSize: 500 });

/**
 * Render cache for full HTML output.
 * Uses shorter TTL since outputs depend on input/output data.
 */
export const renderCache = new TranspileCache({
  maxSize: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
});

/**
 * Simple LRU cache for storing any type of values.
 * Used for caching compiled components (React/MDX).
 */
export class ComponentCache<T = unknown> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private readonly maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Move to end for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Enforce size limit with LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Global component cache for storing compiled React/MDX components.
 */
export const componentCache = new ComponentCache();
