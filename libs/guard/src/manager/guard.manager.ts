/**
 * Guard Manager
 *
 * Central coordinator for rate limiting, concurrency control, IP filtering,
 * and timeout within a scope. SDK-agnostic — built on StorageAdapter.
 */

import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import { DistributedSemaphore } from '../concurrency/semaphore';
import type { ConcurrencyConfig, SemaphoreTicket } from '../concurrency/types';
import { GuardError, GuardStorageUnavailableError } from '../errors';
import { IpFilter } from '../ip-filter/ip-filter';
import type { IpFilterResult } from '../ip-filter/types';
import { buildStorageKey, resolvePartitionKey } from '../partition-key/partition-key.resolver';
import type { PartitionKeyContext } from '../partition-key/types';
import { SlidingWindowRateLimiter } from '../rate-limit/rate-limiter';
import type { RateLimitConfig, RateLimitResult } from '../rate-limit/types';
import type { GuardConfig, GuardManagerOptions } from './types';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_RETRY_PRIMARY_AFTER_MS = 30_000;
const MEMORY_NAMESPACE = 'mcp:guard';

interface LimitBackend {
  rateLimiter: SlidingWindowRateLimiter;
  semaphore: DistributedSemaphore;
}

export class GuardManager {
  private readonly primary: LimitBackend;
  private memoryBackend?: Promise<LimitBackend>;
  private memoryUntil = 0;
  private outageLogged = false;
  private readonly ipFilter?: IpFilter;
  private readonly storageType: string;
  private readonly fallback: 'error' | 'memory';
  private readonly retryPrimaryAfterMs: number;
  private readonly logger?: GuardManagerOptions['logger'];
  readonly config: GuardConfig;

  constructor(
    private readonly storage: NamespacedStorage,
    config: GuardConfig,
    options: GuardManagerOptions = {},
  ) {
    this.config = config;
    this.primary = { rateLimiter: new SlidingWindowRateLimiter(storage), semaphore: new DistributedSemaphore(storage) };
    this.storageType = options.storageType ?? 'storage';
    this.fallback = options.fallback ?? 'error';
    this.retryPrimaryAfterMs = options.retryPrimaryAfterMs ?? DEFAULT_RETRY_PRIMARY_AFTER_MS;
    this.logger = options.logger;

    if (config.ipFilter) {
      this.ipFilter = new IpFilter(config.ipFilter);
    }
  }

  // ============================================
  // IP Filtering
  // ============================================

  /**
   * Check if a client IP is allowed by the IP filter.
   * Returns undefined only if no IP filter is configured; a missing IP gets `defaultAction` (GHSA-hwfp-xv2f-fr8g).
   */
  checkIpFilter(clientIp: string | undefined): IpFilterResult | undefined {
    if (!this.ipFilter) return undefined;
    return this.ipFilter.check(clientIp);
  }

  /**
   * Check if a client IP is on the allow list (bypasses rate limiting).
   */
  isIpAllowListed(clientIp: string | undefined): boolean {
    if (!this.ipFilter) return false;
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

    return this.withBackend((b) => b.rateLimiter.check(storageKey, config.maxRequests, windowMs));
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

    return this.withBackend((b) => b.rateLimiter.check(storageKey, config.maxRequests, windowMs));
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

    return this.acquireTicket(storageKey, config.maxConcurrent, queueTimeoutMs, entityName);
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

    return this.acquireTicket(storageKey, config.maxConcurrent, queueTimeoutMs, '__global__');
  }

  // ============================================
  // Storage outages
  // ============================================

  /**
   * Run a limit operation against the configured storage. When that storage
   * stops answering (Redis gone while the server runs), the call fails with
   * `GuardStorageUnavailableError` — the same error startup raises — unless
   * `fallback: 'memory'` allows per-instance counters for the duration.
   * Limit errors (`GuardError`) are the operation's own answer and pass through.
   */
  private async withBackend<T>(operation: (backend: LimitBackend) => Promise<T>): Promise<T> {
    if (this.memoryUntil > Date.now()) {
      return operation(await this.getMemoryBackend());
    }

    try {
      const result = await operation(this.primary);
      if (this.outageLogged) {
        this.outageLogged = false;
        this.logger?.info(`GuardManager: throttle.storage (${this.storageType}) is available again`);
      }
      return result;
    } catch (error) {
      if (error instanceof GuardError) throw error;
      if (this.fallback !== 'memory') {
        throw new GuardStorageUnavailableError(this.storageType, error, 'runtime');
      }
      if (!this.outageLogged) {
        this.outageLogged = true;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger?.warn(
          `GuardManager: throttle.storage (${this.storageType}) is unavailable: ${reason}. ` +
            'Using per-instance in-memory counters until it answers again.',
        );
      }
      this.memoryUntil = Date.now() + this.retryPrimaryAfterMs;
      return operation(await this.getMemoryBackend());
    }
  }

  private getMemoryBackend(): Promise<LimitBackend> {
    this.memoryBackend ??= (async () => {
      const root = createMemoryStorage();
      await root.connect();
      const memory = root.namespace(MEMORY_NAMESPACE);
      return { rateLimiter: new SlidingWindowRateLimiter(memory), semaphore: new DistributedSemaphore(memory) };
    })();
    return this.memoryBackend;
  }

  private async acquireTicket(
    storageKey: string,
    maxConcurrent: number,
    queueTimeoutMs: number,
    entityName: string,
  ): Promise<SemaphoreTicket | null> {
    const ticket = await this.withBackend((b) =>
      b.semaphore.acquire(storageKey, maxConcurrent, queueTimeoutMs, entityName),
    );
    if (!ticket) return null;
    // The call has already run by the time a slot is released; a storage failure here must not
    // replace its result. The slot's TTL reclaims it.
    return {
      ticket: ticket.ticket,
      release: async () => {
        try {
          await ticket.release();
        } catch (error) {
          this.logger?.warn(
            `GuardManager: could not release the concurrency slot for "${entityName}": ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    };
  }

  // ============================================
  // Lifecycle
  // ============================================

  async destroy(): Promise<void> {
    await this.storage.disconnect();
  }
}
