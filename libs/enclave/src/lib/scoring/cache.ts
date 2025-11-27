/**
 * Scoring Cache
 *
 * LRU cache for scoring results to avoid re-scoring identical code.
 * Uses SHA-256 code hash as the cache key.
 *
 * @packageDocumentation
 */

import type { ScoringResult, ScoringCacheConfig } from './types';
import { DEFAULT_SCORING_CONFIG } from './types';

/**
 * Cache entry with metadata
 */
interface CacheEntry {
  /**
   * Cached scoring result
   */
  result: ScoringResult;

  /**
   * Timestamp when entry was created
   */
  timestamp: number;

  /**
   * Number of cache hits
   */
  hits: number;
}

/**
 * LRU Cache for scoring results
 */
export class ScoringCache {
  private readonly cache: Map<string, CacheEntry>;
  private readonly config: Required<ScoringCacheConfig>;
  private totalHits = 0;
  private totalMisses = 0;

  constructor(config?: Partial<ScoringCacheConfig>) {
    this.cache = new Map();
    this.config = {
      enabled: config?.enabled ?? DEFAULT_SCORING_CONFIG.cache.enabled,
      ttlMs: config?.ttlMs ?? DEFAULT_SCORING_CONFIG.cache.ttlMs,
      maxEntries: config?.maxEntries ?? DEFAULT_SCORING_CONFIG.cache.maxEntries,
    };
  }

  /**
   * Get a cached result by code hash
   *
   * @param codeHash - SHA-256 hash of the code
   * @returns Cached result or undefined if not found/expired
   */
  get(codeHash: string): ScoringResult | undefined {
    if (!this.config.enabled) {
      return undefined;
    }

    const entry = this.cache.get(codeHash);

    if (!entry) {
      this.totalMisses++;
      return undefined;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(codeHash);
      this.totalMisses++;
      return undefined;
    }

    // Update hit count
    entry.hits++;
    this.totalHits++;

    // Move to end (most recently used)
    this.cache.delete(codeHash);
    this.cache.set(codeHash, entry);

    return entry.result;
  }

  /**
   * Store a result in the cache
   *
   * @param codeHash - SHA-256 hash of the code
   * @param result - Scoring result to cache
   */
  set(codeHash: string, result: ScoringResult): void {
    if (!this.config.enabled) {
      return;
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(codeHash, {
      result,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Check if a key exists and is valid
   */
  has(codeHash: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const entry = this.cache.get(codeHash);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(codeHash);
      return false;
    }

    return true;
  }

  /**
   * Remove a specific entry
   */
  delete(codeHash: string): boolean {
    return this.cache.delete(codeHash);
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.ttlMs) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxEntries: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    enabled: boolean;
  } {
    const total = this.totalHits + this.totalMisses;
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      enabled: this.config.enabled,
    };
  }

  /**
   * Check if caching is enabled
   */
  get enabled(): boolean {
    return this.config.enabled;
  }
}
