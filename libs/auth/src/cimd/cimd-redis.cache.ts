/**
 * Redis-backed CIMD Cache Implementation
 *
 * Provides a Redis-backed cache for CIMD documents.
 * Uses the RedisStorageAdapter from @frontmcp/utils for Redis operations.
 */
import { RedisStorageAdapter, type RedisAdapterOptions } from '@frontmcp/utils';
import { sha256Hex } from '@frontmcp/utils';
import type { CimdCacheBackend, CimdCacheEntry, CimdCacheTtlConfig } from './cimd.cache';
import { extractCacheHeaders, parseCacheHeaders } from './cimd.cache';
import type { ClientMetadataDocument, CimdCacheConfig } from './cimd.types';

/**
 * Serialized cache entry format for Redis storage.
 */
interface SerializedCimdCacheEntry {
  document: ClientMetadataDocument;
  expiresAt: number;
  etag?: string;
  lastModified?: string;
  cachedAt: number;
}

/**
 * Redis-backed CIMD document cache.
 *
 * Stores cached CIMD documents in Redis with HTTP cache-aware TTLs.
 * Suitable for production and distributed deployments.
 *
 * Key format: {keyPrefix}{sha256(clientId)}
 * Value format: JSON-serialized CimdCacheEntry
 *
 * @example
 * ```typescript
 * const cache = new RedisCimdCache({
 *   redis: { url: 'redis://localhost:6379' },
 *   defaultTtlMs: 3600_000,
 * });
 * await cache.connect();
 *
 * // Cache will be usable after connect()
 * await cache.set(clientId, document, headers);
 * const entry = await cache.get(clientId);
 *
 * // Close when done
 * await cache.close();
 * ```
 */
export class RedisCimdCache implements CimdCacheBackend {
  private readonly redis: RedisStorageAdapter;
  private readonly keyPrefix: string;
  protected readonly config: CimdCacheTtlConfig;

  constructor(config: CimdCacheConfig) {
    if (!config.redis) {
      throw new Error('Redis configuration is required for RedisCimdCache');
    }

    this.config = {
      defaultTtlMs: config.defaultTtlMs ?? 3600_000,
      maxTtlMs: config.maxTtlMs ?? 86400_000,
      minTtlMs: config.minTtlMs ?? 60_000,
    };

    this.keyPrefix = config.redis.keyPrefix ?? 'cimd:';

    // Build Redis adapter options
    const redisOptions: RedisAdapterOptions = {};

    if (config.redis.url) {
      redisOptions.url = config.redis.url;
    } else if (config.redis.host) {
      redisOptions.config = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        tls: config.redis.tls,
      };
    }

    this.redis = new RedisStorageAdapter(redisOptions);
  }

  /**
   * Connect to Redis.
   * Must be called before using any cache operations.
   */
  async connect(): Promise<void> {
    await this.redis.connect();
  }

  /**
   * Generate a Redis key for a client ID.
   * Uses SHA-256 hash to handle URLs with special characters.
   */
  private cacheKey(clientId: string): string {
    const hash = sha256Hex(clientId);
    return `${this.keyPrefix}${hash}`;
  }

  /**
   * Get a cached entry by client_id.
   *
   * @param clientId - The client_id URL
   * @returns The cached entry if valid, or undefined
   */
  async get(clientId: string): Promise<CimdCacheEntry | undefined> {
    const key = this.cacheKey(clientId);
    const data = await this.redis.get(key);

    if (!data) {
      return undefined;
    }

    try {
      const entry = JSON.parse(data) as SerializedCimdCacheEntry;

      // Check if entry is expired
      if (entry.expiresAt < Date.now()) {
        // Don't delete - we might want to do a conditional request
        // Return undefined to indicate it's stale
        return undefined;
      }

      return entry;
    } catch {
      // Invalid JSON, delete and return undefined
      await this.redis.delete(key);
      return undefined;
    }
  }

  /**
   * Get a stale entry for conditional revalidation.
   *
   * @param clientId - The client_id URL
   * @returns The stale entry (even if expired), or undefined if not cached
   */
  async getStale(clientId: string): Promise<CimdCacheEntry | undefined> {
    const key = this.cacheKey(clientId);
    const data = await this.redis.get(key);

    if (!data) {
      return undefined;
    }

    try {
      return JSON.parse(data) as CimdCacheEntry;
    } catch {
      return undefined;
    }
  }

  /**
   * Store a document in the cache.
   *
   * @param clientId - The client_id URL
   * @param document - The metadata document
   * @param headers - HTTP response headers
   */
  async set(clientId: string, document: ClientMetadataDocument, headers: Headers): Promise<void> {
    const cacheHeaders = extractCacheHeaders(headers);
    const { ttlMs, etag, lastModified } = parseCacheHeaders(cacheHeaders, this.config);

    const now = Date.now();
    const entry: SerializedCimdCacheEntry = {
      document,
      expiresAt: now + ttlMs,
      etag,
      lastModified,
      cachedAt: now,
    };

    const key = this.cacheKey(clientId);
    const value = JSON.stringify(entry);

    // Store with TTL - use 2x maxTtlMs for cleanup margin (allows conditional revalidation)
    const redisTtlSeconds = Math.ceil((ttlMs + this.config.maxTtlMs * 2) / 1000);

    await this.redis.set(key, value, { ttlSeconds: redisTtlSeconds });
  }

  /**
   * Update an existing cache entry (after 304 Not Modified).
   *
   * @param clientId - The client_id URL
   * @param headers - New HTTP headers with updated cache directives
   */
  async revalidate(clientId: string, headers: Headers): Promise<boolean> {
    const key = this.cacheKey(clientId);
    const data = await this.redis.get(key);

    if (!data) {
      return false;
    }

    try {
      const existing = JSON.parse(data) as SerializedCimdCacheEntry;
      const cacheHeaders = extractCacheHeaders(headers);
      const { ttlMs, etag, lastModified } = parseCacheHeaders(cacheHeaders, this.config);

      // Update expiration and conditional headers
      existing.expiresAt = Date.now() + ttlMs;
      if (etag) existing.etag = etag;
      if (lastModified) existing.lastModified = lastModified;

      const value = JSON.stringify(existing);
      const redisTtlSeconds = Math.ceil((ttlMs + this.config.maxTtlMs * 2) / 1000);

      await this.redis.set(key, value, { ttlSeconds: redisTtlSeconds });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a cache entry.
   *
   * @param clientId - The client_id URL
   * @returns true if an entry was deleted
   */
  async delete(clientId: string): Promise<boolean> {
    const key = this.cacheKey(clientId);
    return this.redis.delete(key);
  }

  /**
   * Get conditional request headers for a cached entry.
   *
   * @param clientId - The client_id URL
   * @returns Headers for conditional request, or undefined if not cached
   */
  async getConditionalHeaders(clientId: string): Promise<Record<string, string> | undefined> {
    const key = this.cacheKey(clientId);
    const data = await this.redis.get(key);

    if (!data) {
      return undefined;
    }

    try {
      const entry = JSON.parse(data) as SerializedCimdCacheEntry;
      const headers: Record<string, string> = {};

      if (entry.etag) {
        headers['If-None-Match'] = entry.etag;
      }

      if (entry.lastModified) {
        headers['If-Modified-Since'] = entry.lastModified;
      }

      return Object.keys(headers).length > 0 ? headers : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Clear all cached entries.
   * Uses Redis SCAN to find and delete all keys with our prefix.
   */
  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.redis.mdelete(keys);
    }
  }

  /**
   * Get the number of cached entries.
   * Uses Redis SCAN to count keys with our prefix.
   */
  async size(): Promise<number> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    return keys.length;
  }

  /**
   * Remove expired entries.
   *
   * Note: Redis handles expiration automatically via TTL.
   * This method is primarily for explicit cleanup of entries that are
   * well past their HTTP cache expiration but still within Redis TTL.
   *
   * @returns Number of entries removed
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;

    const keys = await this.redis.keys(`${this.keyPrefix}*`);

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      try {
        const entry = JSON.parse(data) as SerializedCimdCacheEntry;
        // Remove entries that are very old (2x max TTL past expiration)
        if (entry.expiresAt + this.config.maxTtlMs * 2 < now) {
          await this.redis.delete(key);
          removed++;
        }
      } catch {
        // Invalid JSON, remove it
        await this.redis.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    await this.redis.disconnect();
  }
}
