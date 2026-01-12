/**
 * CredentialCache - Session-scoped in-memory cache for credentials
 *
 * Provides fast access to recently used credentials with TTL-based expiration.
 * Each cache instance is scoped to a session/request context.
 */

import type { Credential } from '../session';
import type { ResolvedCredential, CredentialCacheEntry, CredentialScope } from './auth-providers.types';

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/**
 * CredentialCache - In-memory credential cache with TTL support
 */
export class CredentialCache {
  private readonly cache = new Map<string, CredentialCacheEntry>();
  private readonly maxSize: number;
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 };

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get a cached credential
   *
   * @param providerId - Provider name
   * @returns Resolved credential or undefined if not cached or expired
   */
  get<T extends Credential = Credential>(providerId: string): ResolvedCredential<T> | undefined {
    const entry = this.cache.get(providerId);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(providerId);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }

    // Check credential expiration
    if (entry.resolved.expiresAt && Date.now() >= entry.resolved.expiresAt) {
      this.cache.delete(providerId);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }

    this.stats.hits++;
    return entry.resolved as ResolvedCredential<T>;
  }

  /**
   * Cache a resolved credential
   *
   * @param providerId - Provider name
   * @param resolved - Resolved credential to cache
   * @param ttl - TTL in milliseconds (0 = no TTL, rely on credential expiry)
   */
  set<T extends Credential = Credential>(providerId: string, resolved: ResolvedCredential<T>, ttl = 0): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(providerId)) {
      this.evictOldest();
    }

    const entry: CredentialCacheEntry<T> = {
      resolved,
      cachedAt: Date.now(),
      ttl,
    };

    this.cache.set(providerId, entry as CredentialCacheEntry);
    this.stats.size = this.cache.size;
  }

  /**
   * Check if a credential is cached and valid
   *
   * @param providerId - Provider name
   * @returns true if cached and not expired
   */
  has(providerId: string): boolean {
    const entry = this.cache.get(providerId);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.cache.delete(providerId);
      this.stats.size = this.cache.size;
      this.stats.evictions++;
      return false;
    }

    return true;
  }

  /**
   * Invalidate (remove) a cached credential
   *
   * @param providerId - Provider name to invalidate
   * @returns true if credential was removed
   */
  invalidate(providerId: string): boolean {
    const deleted = this.cache.delete(providerId);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Invalidate all cached credentials
   */
  invalidateAll(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Invalidate credentials by scope
   *
   * @param scope - Credential scope to invalidate
   */
  invalidateByScope(scope: CredentialScope): void {
    for (const [key, entry] of this.cache) {
      if (entry.resolved.scope === scope) {
        this.cache.delete(key);
      }
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Get all cached provider IDs
   */
  keys(): string[] {
    // Clean up expired entries first
    this.cleanup();
    return [...this.cache.keys()];
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0, size: this.cache.size };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (this.isExpiredAt(entry, now)) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Check if entry is expired based on TTL
   */
  private isExpired(entry: CredentialCacheEntry): boolean {
    return this.isExpiredAt(entry, Date.now());
  }

  /**
   * Check if entry is expired at a given timestamp
   */
  private isExpiredAt(entry: CredentialCacheEntry, now: number): boolean {
    // Check TTL
    if (entry.ttl > 0 && now - entry.cachedAt >= entry.ttl) {
      return true;
    }

    // Check credential expiration
    if (entry.resolved.expiresAt && now >= entry.resolved.expiresAt) {
      return true;
    }

    // Check validity flag
    if (!entry.resolved.isValid) {
      return true;
    }

    return false;
  }

  /**
   * Evict the oldest entry from cache
   */
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size = this.cache.size;
    }
  }
}
