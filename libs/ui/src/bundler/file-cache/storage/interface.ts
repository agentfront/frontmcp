/**
 * Build Cache Storage Interface
 *
 * Abstract interface for storing and retrieving component build manifests.
 * Implementations include filesystem (development) and Redis (production).
 *
 * @packageDocumentation
 */

import type { ComponentBuildManifest, CacheStats } from '@frontmcp/uipack/dependency';

/**
 * Options for storage initialization.
 */
export interface StorageOptions {
  /**
   * Maximum number of entries to store.
   * @default 1000
   */
  maxEntries?: number;

  /**
   * Maximum total size in bytes.
   * @default 104857600 (100MB)
   */
  maxSize?: number;

  /**
   * Default TTL in seconds.
   * @default 86400 (24 hours)
   */
  defaultTtl?: number;

  /**
   * Whether to compress stored data.
   * @default false
   */
  compress?: boolean;
}

/**
 * Abstract interface for build cache storage.
 *
 * Implementations should handle:
 * - Key-value storage of ComponentBuildManifest
 * - TTL-based expiration
 * - Size-based eviction
 * - Concurrent access safety
 */
export interface BuildCacheStorage {
  /**
   * Storage identifier for logging/debugging.
   */
  readonly type: string;

  /**
   * Initialize the storage backend.
   * Must be called before other operations.
   */
  initialize(): Promise<void>;

  /**
   * Retrieve a cached build manifest by key.
   *
   * @param key - Cache key (typically content hash)
   * @returns Cached manifest or undefined if not found/expired
   */
  get(key: string): Promise<ComponentBuildManifest | undefined>;

  /**
   * Store a build manifest in cache.
   *
   * @param key - Cache key
   * @param manifest - Build manifest to store
   * @param ttl - Optional TTL in seconds (overrides default)
   */
  set(key: string, manifest: ComponentBuildManifest, ttl?: number): Promise<void>;

  /**
   * Check if a key exists in cache (and is not expired).
   *
   * @param key - Cache key to check
   * @returns true if key exists and is valid
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete a cached entry.
   *
   * @param key - Cache key to delete
   * @returns true if entry was deleted, false if not found
   */
  delete(key: string): Promise<boolean>;

  /**
   * Clear all cached entries.
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics.
   */
  getStats(): Promise<CacheStats>;

  /**
   * Clean up expired entries.
   * Returns number of entries removed.
   */
  cleanup(): Promise<number>;

  /**
   * Close the storage connection.
   * Should be called when the application shuts down.
   */
  close(): Promise<void>;
}

/**
 * Metadata for a cached entry.
 */
export interface CacheEntryMetadata {
  /**
   * Cache key.
   */
  key: string;

  /**
   * Size of the cached data in bytes.
   */
  size: number;

  /**
   * Timestamp when entry was created (ms since epoch).
   */
  createdAt: number;

  /**
   * Timestamp when entry expires (ms since epoch).
   */
  expiresAt: number;

  /**
   * Last access timestamp (ms since epoch).
   */
  lastAccessedAt: number;

  /**
   * Number of times the entry has been accessed.
   */
  accessCount: number;
}

/**
 * Wrapper around cached data with metadata.
 */
export interface CacheEntry<T = ComponentBuildManifest> {
  /**
   * The cached data.
   */
  data: T;

  /**
   * Entry metadata.
   */
  metadata: CacheEntryMetadata;
}

/**
 * Default storage options.
 */
export const DEFAULT_STORAGE_OPTIONS: Required<StorageOptions> = {
  maxEntries: 1000,
  maxSize: 100 * 1024 * 1024, // 100MB
  defaultTtl: 24 * 60 * 60, // 24 hours
  compress: false,
};

/**
 * Calculate the size of a manifest in bytes.
 */
export function calculateManifestSize(manifest: ComponentBuildManifest): number {
  // Approximate size by serializing to JSON
  try {
    return Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  } catch {
    // Fallback for circular references or BigInt values
    return 0;
  }
}
