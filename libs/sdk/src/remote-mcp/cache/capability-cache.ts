/**
 * @file capability-cache.ts
 * @description TTL-based capability cache for remote MCP servers
 */

import type { McpRemoteCapabilities } from '../mcp-client.types';

/**
 * Cached capability entry with expiration tracking
 */
interface CachedCapabilities {
  /** The cached capabilities */
  capabilities: McpRemoteCapabilities;
  /** Timestamp when the cache expires */
  expiresAt: number;
  /** Timestamp when capabilities were fetched */
  fetchedAt: Date;
}

/**
 * Configuration for the capability cache
 */
export interface CapabilityCacheConfig {
  /** Default TTL in milliseconds (default: 60000 = 60 seconds) */
  defaultTTL?: number;
}

/**
 * TTL-based capability cache for remote MCP servers.
 *
 * Features:
 * - Configurable TTL per app or global default
 * - Automatic expiration checking
 * - Thread-safe for single-threaded Node.js
 */
export class CapabilityCache {
  private readonly cache = new Map<string, CachedCapabilities>();
  private readonly defaultTTL: number;

  constructor(config: CapabilityCacheConfig = {}) {
    this.defaultTTL = config.defaultTTL ?? 60000; // Default 60 seconds
  }

  /**
   * Get cached capabilities for an app.
   * Returns null if not cached or expired.
   *
   * @param appId - The remote app ID
   * @returns Cached capabilities or null
   */
  get(appId: string): McpRemoteCapabilities | null {
    const cached = this.cache.get(appId);
    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(appId);
      return null;
    }

    return cached.capabilities;
  }

  /**
   * Store capabilities in the cache.
   *
   * @param appId - The remote app ID
   * @param capabilities - The capabilities to cache
   * @param ttl - Optional TTL in milliseconds (uses default if not specified)
   */
  set(appId: string, capabilities: McpRemoteCapabilities, ttl?: number): void {
    const effectiveTTL = ttl ?? this.defaultTTL;
    this.cache.set(appId, {
      capabilities,
      expiresAt: Date.now() + effectiveTTL,
      fetchedAt: new Date(),
    });
  }

  /**
   * Invalidate cached capabilities for an app.
   *
   * @param appId - The remote app ID
   */
  invalidate(appId: string): void {
    this.cache.delete(appId);
  }

  /**
   * Clear all cached capabilities.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if capabilities are expired or not cached.
   *
   * @param appId - The remote app ID
   * @returns True if expired or not cached
   */
  isExpired(appId: string): boolean {
    const cached = this.cache.get(appId);
    if (!cached) {
      return true;
    }
    return Date.now() > cached.expiresAt;
  }

  /**
   * Get the time remaining until expiration.
   *
   * @param appId - The remote app ID
   * @returns Time remaining in milliseconds, or 0 if expired/not cached
   */
  getTimeToExpiry(appId: string): number {
    const cached = this.cache.get(appId);
    if (!cached) {
      return 0;
    }
    const remaining = cached.expiresAt - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Get the timestamp when capabilities were fetched.
   *
   * @param appId - The remote app ID
   * @returns Fetch timestamp or null if not cached
   */
  getFetchedAt(appId: string): Date | null {
    const cached = this.cache.get(appId);
    return cached?.fetchedAt ?? null;
  }

  /**
   * Get all cached app IDs.
   *
   * @returns Array of app IDs with active (non-expired) cache entries
   */
  getCachedAppIds(): string[] {
    const now = Date.now();
    const activeIds: string[] = [];

    for (const [appId, cached] of this.cache.entries()) {
      if (cached.expiresAt > now) {
        activeIds.push(appId);
      }
    }

    return activeIds;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { totalEntries: number; activeEntries: number; expiredEntries: number } {
    const now = Date.now();
    let activeEntries = 0;
    let expiredEntries = 0;

    for (const cached of this.cache.values()) {
      if (cached.expiresAt > now) {
        activeEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      activeEntries,
      expiredEntries,
    };
  }
}
