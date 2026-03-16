/**
 * Guard Manager
 *
 * Central coordinator for rate limiting, concurrency control, IP filtering,
 * and timeout within a scope. SDK-agnostic — built on StorageAdapter.
 */

import type { NamespacedStorage } from '@frontmcp/utils';
import type { GuardConfig } from './types';
import type { RateLimitConfig, RateLimitResult } from '../rate-limit/types';
import type { ConcurrencyConfig, SemaphoreTicket } from '../concurrency/types';
import type { PartitionKeyContext } from '../partition-key/types';
import type { IpFilterResult } from '../ip-filter/types';
import { SlidingWindowRateLimiter } from '../rate-limit/rate-limiter';
import { DistributedSemaphore } from '../concurrency/semaphore';
import { IpFilter } from '../ip-filter/ip-filter';
import { resolvePartitionKey, buildStorageKey } from '../partition-key/partition-key.resolver';

const DEFAULT_WINDOW_MS = 60_000;

export class GuardManager {
  private readonly rateLimiter: SlidingWindowRateLimiter;
  private readonly semaphore: DistributedSemaphore;
  private readonly ipFilter?: IpFilter;
  readonly config: GuardConfig;

  constructor(
    private readonly storage: NamespacedStorage,
    config: GuardConfig,
  ) {
    this.config = config;
    this.rateLimiter = new SlidingWindowRateLimiter(storage);
    this.semaphore = new DistributedSemaphore(storage);

    if (config.ipFilter) {
      this.ipFilter = new IpFilter(config.ipFilter);
    }
  }

  // ============================================
  // IP Filtering
  // ============================================

  /**
   * Check if a client IP is allowed by the IP filter.
   * Returns undefined if no IP filter is configured.
   */
  checkIpFilter(clientIp: string | undefined): IpFilterResult | undefined {
    if (!this.ipFilter || !clientIp) return undefined;
    return this.ipFilter.check(clientIp);
  }

  /**
   * Check if a client IP is on the allow list (bypasses rate limiting).
   */
  isIpAllowListed(clientIp: string | undefined): boolean {
    if (!this.ipFilter || !clientIp) return false;
    return this.ipFilter.isAllowListed(clientIp);
  }

  // ============================================
  // Rate Limiting
  // ============================================

  /**
   * Check per-entity rate limit.
   * Merges entity config with app-level defaults (entity takes precedence).
   */
  async checkRateLimit(
    entityName: string,
    entityConfig: RateLimitConfig | undefined,
    context: PartitionKeyContext | undefined,
  ): Promise<RateLimitResult> {
    const config = entityConfig ?? this.config.defaultRateLimit;
    if (!config) {
      return { allowed: true, remaining: Infinity, resetMs: 0 };
    }

    const partitionKey = resolvePartitionKey(config.partitionBy, context);
    const storageKey = buildStorageKey(entityName, partitionKey, 'rl');
    const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;

    return this.rateLimiter.check(storageKey, config.maxRequests, windowMs);
  }

  /**
   * Check global rate limit.
   */
  async checkGlobalRateLimit(context: PartitionKeyContext | undefined): Promise<RateLimitResult> {
    const config = this.config.global;
    if (!config) {
      return { allowed: true, remaining: Infinity, resetMs: 0 };
    }

    const partitionKey = resolvePartitionKey(config.partitionBy, context);
    const storageKey = buildStorageKey('__global__', partitionKey, 'rl');
    const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;

    return this.rateLimiter.check(storageKey, config.maxRequests, windowMs);
  }

  // ============================================
  // Concurrency Control
  // ============================================

  /**
   * Acquire a concurrency slot for an entity.
   */
  async acquireSemaphore(
    entityName: string,
    entityConfig: ConcurrencyConfig | undefined,
    context: PartitionKeyContext | undefined,
  ): Promise<SemaphoreTicket | null> {
    const config = entityConfig ?? this.config.defaultConcurrency;
    if (!config) return null;

    const partitionKey = resolvePartitionKey(config.partitionBy, context);
    const storageKey = buildStorageKey(entityName, partitionKey, 'sem');
    const queueTimeoutMs = config.queueTimeoutMs ?? 0;

    return this.semaphore.acquire(storageKey, config.maxConcurrent, queueTimeoutMs, entityName);
  }

  /**
   * Acquire a global concurrency slot.
   */
  async acquireGlobalSemaphore(context: PartitionKeyContext | undefined): Promise<SemaphoreTicket | null> {
    const config = this.config.globalConcurrency;
    if (!config) return null;

    const partitionKey = resolvePartitionKey(config.partitionBy, context);
    const storageKey = buildStorageKey('__global__', partitionKey, 'sem');
    const queueTimeoutMs = config.queueTimeoutMs ?? 0;

    return this.semaphore.acquire(storageKey, config.maxConcurrent, queueTimeoutMs, '__global__');
  }

  // ============================================
  // Lifecycle
  // ============================================

  async destroy(): Promise<void> {
    await this.storage.disconnect();
  }
}
