/**
 * CIMD HTTP Cache-Aware Caching
 *
 * Implements caching for CIMD documents that respects HTTP cache headers
 * like Cache-Control, Expires, ETag, and Last-Modified.
 */
import type { ClientMetadataDocument, CimdCacheConfig } from './cimd.types';

/**
 * Cache entry for a CIMD document.
 */
export interface CimdCacheEntry {
  /**
   * The cached metadata document.
   */
  document: ClientMetadataDocument;

  /**
   * When the entry expires (Unix timestamp in ms).
   */
  expiresAt: number;

  /**
   * HTTP ETag for conditional requests.
   */
  etag?: string;

  /**
   * HTTP Last-Modified header value.
   */
  lastModified?: string;

  /**
   * When the entry was cached (Unix timestamp in ms).
   */
  cachedAt: number;
}

/**
 * Headers relevant to caching.
 */
export interface CacheableHeaders {
  'cache-control'?: string;
  expires?: string;
  etag?: string;
  'last-modified'?: string;
  age?: string;
}

/**
 * Parse cache-relevant headers from a Response or Headers object.
 */
export function extractCacheHeaders(headers: Headers): CacheableHeaders {
  return {
    'cache-control': headers.get('cache-control') ?? undefined,
    expires: headers.get('expires') ?? undefined,
    etag: headers.get('etag') ?? undefined,
    'last-modified': headers.get('last-modified') ?? undefined,
    age: headers.get('age') ?? undefined,
  };
}

/**
 * Parse cache headers and compute TTL.
 *
 * @param headers - Cache-relevant headers
 * @param config - Cache configuration with min/max/default TTL
 * @returns Object with computed TTL and conditional request headers
 */
export function parseCacheHeaders(
  headers: CacheableHeaders,
  config: CimdCacheConfig,
): {
  ttlMs: number;
  etag?: string;
  lastModified?: string;
} {
  let ttlMs = config.defaultTtlMs;

  // Parse Cache-Control header
  if (headers['cache-control']) {
    const cacheControl = parseCacheControlHeader(headers['cache-control']);

    // no-store or no-cache means use minimum TTL
    if (cacheControl['no-store'] || cacheControl['no-cache']) {
      ttlMs = config.minTtlMs;
    }
    // max-age directive
    else if (typeof cacheControl['max-age'] === 'number') {
      let maxAgeSecs = cacheControl['max-age'];

      // Subtract Age header if present
      if (headers.age) {
        const ageSeconds = parseInt(headers.age, 10);
        if (!isNaN(ageSeconds)) {
          maxAgeSecs = Math.max(0, maxAgeSecs - ageSeconds);
        }
      }

      ttlMs = maxAgeSecs * 1000;
    }
    // s-maxage takes precedence for shared caches
    if (typeof cacheControl['s-maxage'] === 'number') {
      ttlMs = cacheControl['s-maxage'] * 1000;
    }
  }
  // Fall back to Expires header
  else if (headers.expires) {
    const expiresDate = new Date(headers.expires);
    if (!isNaN(expiresDate.getTime())) {
      ttlMs = Math.max(0, expiresDate.getTime() - Date.now());
    }
  }

  // Clamp TTL to configured bounds
  ttlMs = Math.max(config.minTtlMs, Math.min(config.maxTtlMs, ttlMs));

  return {
    ttlMs,
    etag: headers.etag,
    lastModified: headers['last-modified'],
  };
}

/**
 * Parse Cache-Control header into a structured object.
 */
function parseCacheControlHeader(value: string): Record<string, number | boolean> {
  const result: Record<string, number | boolean> = {};

  const directives = value
    .toLowerCase()
    .split(',')
    .map((d) => d.trim());

  for (const directive of directives) {
    const [key, val] = directive.split('=').map((s) => s.trim());

    if (val !== undefined) {
      const numVal = parseInt(val, 10);
      if (!isNaN(numVal)) {
        result[key] = numVal;
      }
    } else {
      result[key] = true;
    }
  }

  return result;
}

/**
 * CIMD document cache.
 *
 * Stores cached CIMD documents with HTTP cache-aware TTLs.
 */
export class CimdCache {
  private cache = new Map<string, CimdCacheEntry>();
  private config: CimdCacheConfig;

  constructor(config?: Partial<CimdCacheConfig>) {
    this.config = {
      defaultTtlMs: config?.defaultTtlMs ?? 3600_000,
      maxTtlMs: config?.maxTtlMs ?? 86400_000,
      minTtlMs: config?.minTtlMs ?? 60_000,
    };
  }

  /**
   * Get a cached entry by client_id.
   *
   * @param clientId - The client_id URL
   * @returns The cached entry if valid, or undefined
   */
  get(clientId: string): CimdCacheEntry | undefined {
    const entry = this.cache.get(clientId);

    if (!entry) {
      return undefined;
    }

    // Check if entry is expired
    if (entry.expiresAt < Date.now()) {
      // Don't delete - we might want to do a conditional request
      // Return undefined to indicate it's stale
      return undefined;
    }

    return entry;
  }

  /**
   * Get a stale entry for conditional revalidation.
   *
   * @param clientId - The client_id URL
   * @returns The stale entry (even if expired), or undefined if not cached
   */
  getStale(clientId: string): CimdCacheEntry | undefined {
    return this.cache.get(clientId);
  }

  /**
   * Store a document in the cache.
   *
   * @param clientId - The client_id URL
   * @param document - The metadata document
   * @param headers - HTTP response headers
   */
  set(clientId: string, document: ClientMetadataDocument, headers: Headers): void {
    const cacheHeaders = extractCacheHeaders(headers);
    const { ttlMs, etag, lastModified } = parseCacheHeaders(cacheHeaders, this.config);

    const now = Date.now();
    const entry: CimdCacheEntry = {
      document,
      expiresAt: now + ttlMs,
      etag,
      lastModified,
      cachedAt: now,
    };

    this.cache.set(clientId, entry);
  }

  /**
   * Update an existing cache entry (after 304 Not Modified).
   *
   * @param clientId - The client_id URL
   * @param headers - New HTTP headers with updated cache directives
   */
  revalidate(clientId: string, headers: Headers): boolean {
    const existing = this.cache.get(clientId);
    if (!existing) {
      return false;
    }

    const cacheHeaders = extractCacheHeaders(headers);
    const { ttlMs, etag, lastModified } = parseCacheHeaders(cacheHeaders, this.config);

    // Update expiration and conditional headers
    existing.expiresAt = Date.now() + ttlMs;
    if (etag) existing.etag = etag;
    if (lastModified) existing.lastModified = lastModified;

    return true;
  }

  /**
   * Delete a cache entry.
   *
   * @param clientId - The client_id URL
   * @returns true if an entry was deleted
   */
  delete(clientId: string): boolean {
    return this.cache.delete(clientId);
  }

  /**
   * Get conditional request headers for a cached entry.
   *
   * @param clientId - The client_id URL
   * @returns Headers for conditional request, or undefined if not cached
   */
  getConditionalHeaders(clientId: string): Record<string, string> | undefined {
    const entry = this.cache.get(clientId);
    if (!entry) {
      return undefined;
    }

    const headers: Record<string, string> = {};

    if (entry.etag) {
      headers['If-None-Match'] = entry.etag;
    }

    if (entry.lastModified) {
      headers['If-Modified-Since'] = entry.lastModified;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Remove expired entries.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [clientId, entry] of this.cache) {
      // Remove entries that are very old (2x max TTL past expiration)
      if (entry.expiresAt + this.config.maxTtlMs * 2 < now) {
        this.cache.delete(clientId);
        removed++;
      }
    }

    return removed;
  }
}
