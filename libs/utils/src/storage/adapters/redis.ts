/**
 * Redis Storage Adapter
 *
 * Redis-based storage implementation for production use.
 * Uses ioredis with dynamic import for browser compatibility.
 */

import { BaseStorageAdapter } from './base';
import type { RedisAdapterOptions, SetOptions, MessageHandler, Unsubscribe } from '../types';
import { StorageConnectionError, StorageConfigError, StorageOperationError } from '../errors';
import { validateTTL } from '../utils/ttl';

// Type imports for ioredis (dynamic import at runtime)
type Redis = import('ioredis').Redis;
type RedisOptions = import('ioredis').RedisOptions;

/**
 * Lazy-load ioredis to avoid bundling in browser builds.
 */
function getRedisClass(): typeof import('ioredis').default {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ioredis').default || require('ioredis');
  } catch {
    throw new Error('ioredis is required for Redis storage adapter. Install it with: npm install ioredis');
  }
}

/**
 * Redis storage adapter.
 *
 * Features:
 * - Native Redis TTL support
 * - SCAN for pattern matching (non-blocking)
 * - Pipeline for batch operations
 * - Pub/sub with separate subscriber connection
 *
 * @example
 * ```typescript
 * const adapter = new RedisStorageAdapter({
 *   url: 'redis://localhost:6379',
 * });
 *
 * await adapter.connect();
 * await adapter.set('key', 'value', { ttlSeconds: 300 });
 * const value = await adapter.get('key');
 * await adapter.disconnect();
 * ```
 */
export class RedisStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'redis';

  private client?: Redis;
  private subscriber?: Redis;
  private readonly options: RedisAdapterOptions;
  private readonly ownsClient: boolean;
  private readonly keyPrefix: string;
  private readonly subscriptionHandlers = new Map<string, Set<MessageHandler>>();

  constructor(options: RedisAdapterOptions = {}) {
    super();

    // Validate options
    const hasClient = options.client !== undefined;
    const hasConfig = options.config !== undefined || options.url !== undefined;

    if (hasClient && hasConfig) {
      throw new StorageConfigError('redis', 'Cannot specify both "client" and "config"/"url". Use one or the other.');
    }

    if (!hasClient && !hasConfig) {
      // Try to get URL from environment
      const envUrl = process.env['REDIS_URL'] || process.env['REDIS_HOST'];
      if (envUrl) {
        options = { ...options, url: envUrl };
      } else {
        throw new StorageConfigError(
          'redis',
          'Either "client", "config", "url", or REDIS_URL environment variable must be provided.',
        );
      }
    }

    this.options = options;
    this.ownsClient = !hasClient;
    this.keyPrefix = options.keyPrefix ?? '';
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      if (this.options.client) {
        // Use external client
        this.client = this.options.client as Redis;
      } else {
        // Create new client
        const RedisClass = getRedisClass();
        if (this.options.url) {
          // Pass URL directly to constructor
          this.client = new RedisClass(this.options.url, this.buildRedisOptions());
        } else {
          this.client = new RedisClass(this.buildRedisOptions());
        }
      }

      // Test connection
      await this.client.ping();
      this.connected = true;
    } catch (e) {
      throw new StorageConnectionError('Failed to connect to Redis', e instanceof Error ? e : undefined, 'redis');
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Close subscriber if we created it
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }

    // Close main client only if we own it
    if (this.ownsClient && this.client) {
      await this.client.quit();
    }

    this.client = undefined;
    this.connected = false;
    this.subscriptionHandlers.clear();
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    return this.client!.get(this.prefixKey(key));
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    this.ensureConnected();
    const prefixedKey = this.prefixKey(key);
    const args: (string | number)[] = [prefixedKey, value];

    // Add TTL if provided
    if (options?.ttlSeconds) {
      args.push('EX', options.ttlSeconds);
    }

    // Add conditional flags
    if (options?.ifNotExists) {
      args.push('NX');
    } else if (options?.ifExists) {
      args.push('XX');
    }

    await (this.client as any).set(...args);
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
  // Batch Operations (pipelined)
  // ============================================

  override async mget(keys: string[]): Promise<(string | null)[]> {
    this.ensureConnected();
    if (keys.length === 0) return [];
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.client!.mget(...prefixedKeys);
  }

  override async mset(entries: import('../types').SetEntry[]): Promise<void> {
    this.ensureConnected();
    if (entries.length === 0) return;

    // Validate all entries first
    for (const entry of entries) {
      this.validateSetOptions(entry.options);
    }

    // Use pipeline for efficiency
    const pipeline = this.client!.pipeline();

    for (const entry of entries) {
      const prefixedKey = this.prefixKey(entry.key);
      const args: (string | number)[] = [prefixedKey, entry.value];

      if (entry.options?.ttlSeconds) {
        args.push('EX', entry.options.ttlSeconds);
      }
      if (entry.options?.ifNotExists) {
        args.push('NX');
      } else if (entry.options?.ifExists) {
        args.push('XX');
      }

      (pipeline as any).set(...args);
    }

    await pipeline.exec();
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
    // Redis returns -2 if key doesn't exist, -1 if no TTL
    if (result === -2) return null;
    return result;
  }

  // ============================================
  // Key Enumeration (SCAN)
  // ============================================

  async keys(pattern: string = '*'): Promise<string[]> {
    this.ensureConnected();

    const prefixedPattern = this.prefixKey(pattern);
    const result: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client!.scan(cursor, 'MATCH', prefixedPattern, 'COUNT', 100);
      cursor = nextCursor;

      // Remove prefix from keys
      for (const key of keys) {
        result.push(this.unprefixKey(key));
      }
    } while (cursor !== '0');

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
  // Pub/Sub
  // ============================================

  override supportsPubSub(): boolean {
    return true;
  }

  override async publish(channel: string, message: string): Promise<number> {
    this.ensureConnected();
    const prefixedChannel = this.prefixKey(channel);
    return this.client!.publish(prefixedChannel, message);
  }

  override async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    this.ensureConnected();
    const prefixedChannel = this.prefixKey(channel);

    // Create subscriber connection if needed
    if (!this.subscriber) {
      await this.createSubscriber();
    }

    // Track handlers
    if (!this.subscriptionHandlers.has(prefixedChannel)) {
      this.subscriptionHandlers.set(prefixedChannel, new Set());
      await this.subscriber!.subscribe(prefixedChannel);
    }
    this.subscriptionHandlers.get(prefixedChannel)!.add(handler);

    // Return unsubscribe function
    return async () => {
      const handlers = this.subscriptionHandlers.get(prefixedChannel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptionHandlers.delete(prefixedChannel);
          await this.subscriber?.unsubscribe(prefixedChannel);
        }
      }
    };
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Build Redis options from config.
   */
  private buildRedisOptions(): RedisOptions {
    if (this.options.url) {
      return {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
      };
    }

    const config = this.options.config!;
    return {
      host: config.host,
      port: config.port ?? 6379,
      password: config.password,
      db: config.db ?? 0,
      tls: config.tls ? {} : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    };
  }

  /**
   * Create subscriber connection.
   */
  private async createSubscriber(): Promise<void> {
    const RedisClass = getRedisClass();

    if (this.options.url) {
      this.subscriber = new RedisClass(this.options.url);
    } else if (this.options.config) {
      this.subscriber = new RedisClass(this.buildRedisOptions());
    } else if (this.options.client) {
      // Duplicate the client for subscriber
      this.subscriber = (this.options.client as Redis).duplicate();
    }

    // Set up message handler
    this.subscriber!.on('message', (channel: string, message: string) => {
      const handlers = this.subscriptionHandlers.get(channel);
      if (handlers) {
        const unprefixedChannel = this.unprefixKey(channel);
        for (const handler of handlers) {
          try {
            handler(message, unprefixedChannel);
          } catch {
            // Ignore handler errors
          }
        }
      }
    });
  }

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

  /**
   * Get the underlying Redis client (for advanced use).
   */
  getClient(): Redis | undefined {
    return this.client;
  }
}
