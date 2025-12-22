/**
 * LRU Cache for Renderer Transpilation Results
 *
 * Provides fast, memory-bounded caching for transpiled templates.
 * Uses content-addressable keys (hash of source) for deduplication.
 */
import type { TranspileResult } from './types';
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
export declare class TranspileCache {
  private cache;
  private readonly maxSize;
  private readonly ttl;
  /** Cache statistics */
  private stats;
  constructor(options?: TranspileCacheOptions);
  /**
   * Get a cached transpile result by source content.
   *
   * @param source - Source code to look up
   * @returns Cached result or undefined if not found/expired
   */
  get(source: string): TranspileResult | undefined;
  /**
   * Get a cached transpile result by hash key.
   *
   * @param key - Hash key
   * @returns Cached result or undefined if not found/expired
   */
  getByKey(key: string): TranspileResult | undefined;
  /**
   * Store a transpile result.
   *
   * @param source - Source code (used to generate key)
   * @param value - Transpile result to cache
   * @returns The hash key used for storage
   */
  set(source: string, value: TranspileResult): string;
  /**
   * Store a transpile result by hash key.
   *
   * @param key - Hash key
   * @param value - Transpile result to cache
   */
  setByKey(key: string, value: TranspileResult): void;
  /**
   * Check if a source is cached.
   *
   * @param source - Source code to check
   * @returns True if cached and not expired
   */
  has(source: string): boolean;
  /**
   * Check if a key is cached.
   *
   * @param key - Hash key to check
   * @returns True if cached and not expired
   */
  hasByKey(key: string): boolean;
  /**
   * Delete a cached entry by source.
   *
   * @param source - Source code to delete
   * @returns True if entry was deleted
   */
  delete(source: string): boolean;
  /**
   * Clear all cached entries.
   */
  clear(): void;
  /**
   * Get current cache size.
   */
  get size(): number;
  /**
   * Get cache statistics.
   */
  getStats(): {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
    hitRate: number;
  };
}
/**
 * Global transpile cache instance.
 * Shared across all renderers for deduplication.
 */
export declare const transpileCache: TranspileCache;
/**
 * Render cache for full HTML output.
 * Uses shorter TTL since outputs depend on input/output data.
 */
export declare const renderCache: TranspileCache;
/**
 * Simple LRU cache for storing any type of values.
 * Used for caching compiled components (React/MDX).
 */
export declare class ComponentCache<T = unknown> {
  private cache;
  private readonly maxSize;
  constructor(maxSize?: number);
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  get size(): number;
}
/**
 * Global component cache for storing compiled React/MDX components.
 */
export declare const componentCache: ComponentCache<unknown>;
//# sourceMappingURL=cache.d.ts.map
