/**
 * Upstash Redis Storage Adapter
 *
 * Upstash Redis (REST-based) storage implementation for edge deployment.
 * Supports pub/sub via Upstash's REST API with polling mechanism.
 */

import { BaseStorageAdapter } from './base';
import type { UpstashAdapterOptions, SetOptions, MessageHandler, Unsubscribe } from '../types';
import { StorageConnectionError, StorageConfigError } from '../errors';
import { validateTTL } from '../utils/ttl';

// Type for @upstash/redis client
type UpstashRedis = {
  get: <T = string>(key: string) => Promise<T | null>;
  set: (key: string, value: string, options?: { ex?: number; nx?: boolean; xx?: boolean }) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  exists: (...keys: string[]) => Promise<number>;
  mget: <T = string>(...keys: string[]) => Promise<(T | null)[]>;
  expire: (key: string, seconds: number) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
  decr: (key: string) => Promise<number>;
  incrby: (key: string, increment: number) => Promise<number>;
  scan: (cursor: number, options?: { match?: string; count?: number }) => Promise<[string, string[]]>;
  publish: (channel: string, message: string) => Promise<number>;
  lpush: (key: string, ...values: string[]) => Promise<number>;
  brpop: (key: string, timeout: number) => Promise<[string, string] | null>;
  rpop: (key: string) => Promise<string | null>;
};

/**
 * Lazy-load @upstash/redis to avoid bundling when not used.
 */
function getUpstashRedis(): { Redis: new (config: { url: string; token: string }) => UpstashRedis } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@upstash/redis');
  } catch {
    throw new Error(
      '@upstash/redis is required for Upstash storage adapter. Install it with: npm install @upstash/redis',
    );
  }
}

/**
 * Polling interval for pub/sub in milliseconds.
 */
const PUBSUB_POLL_INTERVAL_MS = 100;

/**
 * Upstash Redis storage adapter.
 *
 * Features:
 * - REST-based storage for edge deployment
 * - Native TTL support
 * - Pub/sub support via list-based polling
 *
 * @example
 * ```typescript
 * const adapter = new UpstashStorageAdapter({
 *   url: process.env.UPSTASH_REDIS_REST_URL,
 *   token: process.env.UPSTASH_REDIS_REST_TOKEN,
 *   enablePubSub: true,
 * });
 *
 * await adapter.connect();
 * await adapter.set('key', 'value', { ttlSeconds: 300 });
 * const value = await adapter.get('key');
 *
 * // Pub/sub
 * const unsubscribe = await adapter.subscribe('channel', (msg) => console.log(msg));
 * await adapter.publish('channel', 'hello');
 *
 * await adapter.disconnect();
 * ```
 */
export class UpstashStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'upstash';

  private client?: UpstashRedis;
  private readonly options: UpstashAdapterOptions;
  private readonly keyPrefix: string;
  private readonly pubSubEnabled: boolean;

  // Pub/sub state
  private readonly subscriptionHandlers = new Map<string, Set<MessageHandler>>();
  private readonly pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(options: UpstashAdapterOptions = {}) {
    super();

    // Get URL and token from options or environment
    const url = options.url ?? process.env['UPSTASH_REDIS_REST_URL'];
    const token = options.token ?? process.env['UPSTASH_REDIS_REST_TOKEN'];

    if (!url || !token) {
      throw new StorageConfigError(
        'upstash',
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be provided via options or environment variables.',
      );
    }

    this.options = { ...options, url, token };
    this.keyPrefix = options.keyPrefix ?? '';
    this.pubSubEnabled = options.enablePubSub ?? false;
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const { Redis } = getUpstashRedis();
      this.client = new Redis({
        url: this.options.url!,
        token: this.options.token!,
      });

      // Test connection
      await this.client.exists('__healthcheck__');
      this.connected = true;
    } catch (e) {
      throw new StorageConnectionError(
        'Failed to connect to Upstash Redis',
        e instanceof Error ? e : undefined,
        'upstash',
      );
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Stop all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
    this.subscriptionHandlers.clear();

    this.client = undefined;
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.exists('__healthcheck__');
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    const result = await this.client!.get<string>(this.prefixKey(key));
    return result;
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    this.ensureConnected();
    const prefixedKey = this.prefixKey(key);
    const setOptions: { ex?: number; nx?: boolean; xx?: boolean } = {};

    if (options?.ttlSeconds) {
      setOptions.ex = options.ttlSeconds;
    }
    if (options?.ifNotExists) {
      setOptions.nx = true;
    } else if (options?.ifExists) {
      setOptions.xx = true;
    }

    await this.client!.set(prefixedKey, value, Object.keys(setOptions).length > 0 ? setOptions : undefined);
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client!.del(this.prefixKey(key));
    return result > 0;
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client!.exists(this.prefixKey(key));
    return result > 0;
  }

  // ============================================
  // Batch Operations
  // ============================================

  override async mget(keys: string[]): Promise<(string | null)[]> {
    this.ensureConnected();
    if (keys.length === 0) return [];
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.client!.mget<string>(...prefixedKeys);
  }

  override async mdelete(keys: string[]): Promise<number> {
    this.ensureConnected();
    if (keys.length === 0) return 0;
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.client!.del(...prefixedKeys);
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    validateTTL(ttlSeconds);
    const result = await this.client!.expire(this.prefixKey(key), ttlSeconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();
    const result = await this.client!.ttl(this.prefixKey(key));
    if (result === -2) return null;
    return result;
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern: string = '*'): Promise<string[]> {
    this.ensureConnected();

    const prefixedPattern = this.prefixKey(pattern);
    const result: string[] = [];
    let cursor = 0;

    do {
      const [nextCursor, keys] = await this.client!.scan(cursor, {
        match: prefixedPattern,
        count: 100,
      });
      const parsedCursor = typeof nextCursor === 'string' ? parseInt(nextCursor, 10) : nextCursor;
      cursor = Number.isNaN(parsedCursor) ? 0 : parsedCursor;

      for (const key of keys) {
        result.push(this.unprefixKey(key));
      }
    } while (cursor !== 0);

    return result;
  }

  // ============================================
  // Atomic Operations
  // ============================================

  async incr(key: string): Promise<number> {
    this.ensureConnected();
    return this.client!.incr(this.prefixKey(key));
  }

  async decr(key: string): Promise<number> {
    this.ensureConnected();
    return this.client!.decr(this.prefixKey(key));
  }

  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();
    return this.client!.incrby(this.prefixKey(key), amount);
  }

  // ============================================
  // Pub/Sub (via list-based polling)
  // ============================================

  override supportsPubSub(): boolean {
    return this.pubSubEnabled;
  }

  override async publish(channel: string, message: string): Promise<number> {
    this.ensureConnected();

    if (!this.pubSubEnabled) {
      return super.publish(channel, message); // Throws not supported error
    }

    // Use list-based approach to match the polling subscriber
    // Native PUBLISH won't work because subscribe() polls a queue, not native pub/sub
    const prefixedChannel = this.prefixKey(`__pubsub__:${channel}`);
    const listKey = `${prefixedChannel}:queue`;
    await this.client!.lpush(listKey, message);
    return 1; // Return 1 to indicate message was published
  }

  override async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    this.ensureConnected();

    if (!this.pubSubEnabled) {
      return super.subscribe(channel, handler); // Throws not supported error
    }

    const prefixedChannel = this.prefixKey(`__pubsub__:${channel}`);

    // Track handlers
    if (!this.subscriptionHandlers.has(prefixedChannel)) {
      this.subscriptionHandlers.set(prefixedChannel, new Set());

      // Start polling for this channel
      // Note: Upstash REST API doesn't support true pub/sub
      // This uses a list-based approach as a workaround
      const listKey = `${prefixedChannel}:queue`;
      const interval = setInterval(async () => {
        try {
          // Pop messages from the list
          const message = await this.client!.rpop(listKey);
          if (message) {
            const handlers = this.subscriptionHandlers.get(prefixedChannel);
            if (handlers) {
              for (const h of handlers) {
                try {
                  h(message, channel);
                } catch {
                  // Ignore handler errors
                }
              }
            }
          }
        } catch {
          // Ignore polling errors
        }
      }, PUBSUB_POLL_INTERVAL_MS);

      // Unref to allow process exit
      if (interval.unref) {
        interval.unref();
      }

      this.pollingIntervals.set(prefixedChannel, interval);
    }

    this.subscriptionHandlers.get(prefixedChannel)!.add(handler);

    // Return unsubscribe function
    return async () => {
      const handlers = this.subscriptionHandlers.get(prefixedChannel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptionHandlers.delete(prefixedChannel);
          const interval = this.pollingIntervals.get(prefixedChannel);
          if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(prefixedChannel);
          }
        }
      }
    };
  }

  /**
   * Publish using list-based approach (for polling subscribers).
   * This is an alternative to native PUBLISH when subscribers are polling.
   */
  async publishToQueue(channel: string, message: string): Promise<void> {
    this.ensureConnected();

    const prefixedChannel = this.prefixKey(`__pubsub__:${channel}`);
    const listKey = `${prefixedChannel}:queue`;
    await this.client!.lpush(listKey, message);
  }

  protected override getPubSubSuggestion(): string {
    return 'Enable pub/sub by setting enablePubSub: true in the adapter options.';
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Add prefix to a key.
   */
  private prefixKey(key: string): string {
    return this.keyPrefix + key;
  }

  /**
   * Remove prefix from a key.
   */
  private unprefixKey(key: string): string {
    if (this.keyPrefix && key.startsWith(this.keyPrefix)) {
      return key.slice(this.keyPrefix.length);
    }
    return key;
  }
}
