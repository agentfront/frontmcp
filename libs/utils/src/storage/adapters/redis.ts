/**
 * Redis Storage Adapter
 *
 * Redis-based storage implementation for production use.
 * Uses ioredis with dynamic import for browser compatibility.
 */

import { BaseStorageAdapter } from './base';
import type { RedisAdapterOptions, SetOptions, MessageHandler, Unsubscribe } from '../types';
import { StorageConnectionError, StorageConfigError } from '../errors';
import { validateTTL } from '../utils';

// Type imports for ioredis (dynamic import at runtime)
type Redis = import('ioredis').Redis;
type RedisOptions = import('ioredis').RedisOptions;

/**
 * Lazy-load ioredis to avoid bundling in browser builds.
 */
function getRedisClass(): typeof import('ioredis').default {
  try {
    return require('ioredis').default || require('ioredis');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Check if it's a bundler/ESM issue and provide helpful error
    if (msg.includes('Dynamic require') || msg.includes('require is not defined')) {
      throw new Error(
        `Failed to load ioredis: ${msg}. ` +
          'This typically happens with ESM bundlers (esbuild, Vite). ' +
          'Ensure your bundler externalizes ioredis or use CJS mode.',
      );
    }

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
  // Connection Helpers
  // ============================================

  /**
   * Get the connected Redis client, throwing if not connected.
   */
  private getConnectedClient(): Redis {
    this.ensureConnected();
    if (!this.client) {
      throw new StorageConnectionError('Redis client not connected', undefined, 'redis');
    }
    return this.client;
  }

  /**
   * Get the connected Redis subscriber, throwing if not created.
   */
  private getConnectedSubscriber(): Redis {
    if (!this.subscriber) {
      throw new StorageConnectionError('Redis subscriber not created', undefined, 'redis');
    }
    return this.subscriber;
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    return this.getConnectedClient().get(this.prefixKey(key));
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    const client = this.getConnectedClient();
    const prefixedKey = this.prefixKey(key);

    // Build SET command with proper typing
    // Redis SET: SET key value [EX seconds] [NX|XX]
    if (options?.ttlSeconds) {
      if (options.ifNotExists) {
        await client.set(prefixedKey, value, 'EX', options.ttlSeconds, 'NX');
      } else if (options.ifExists) {
        await client.set(prefixedKey, value, 'EX', options.ttlSeconds, 'XX');
      } else {
        await client.set(prefixedKey, value, 'EX', options.ttlSeconds);
      }
    } else if (options?.ifNotExists) {
      await client.set(prefixedKey, value, 'NX');
    } else if (options?.ifExists) {
      await client.set(prefixedKey, value, 'XX');
    } else {
      await client.set(prefixedKey, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.getConnectedClient().del(this.prefixKey(key));
    return result > 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.getConnectedClient().exists(this.prefixKey(key));
    return result > 0;
  }

  // ============================================
  // Batch Operations (pipelined)
  // ============================================

  override async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.getConnectedClient().mget(...prefixedKeys);
  }

  override async mset(entries: import('../types').SetEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Validate all entries first
    for (const entry of entries) {
      this.validateSetOptions(entry.options);
    }

    // Use pipeline for efficiency
    const pipeline = this.getConnectedClient().pipeline();

    for (const entry of entries) {
      const prefixedKey = this.prefixKey(entry.key);

      // Build SET command with proper typing
      if (entry.options?.ttlSeconds) {
        if (entry.options.ifNotExists) {
          pipeline.set(prefixedKey, entry.value, 'EX', entry.options.ttlSeconds, 'NX');
        } else if (entry.options.ifExists) {
          pipeline.set(prefixedKey, entry.value, 'EX', entry.options.ttlSeconds, 'XX');
        } else {
          pipeline.set(prefixedKey, entry.value, 'EX', entry.options.ttlSeconds);
        }
      } else if (entry.options?.ifNotExists) {
        pipeline.set(prefixedKey, entry.value, 'NX');
      } else if (entry.options?.ifExists) {
        pipeline.set(prefixedKey, entry.value, 'XX');
      } else {
        pipeline.set(prefixedKey, entry.value);
      }
    }

    await pipeline.exec();
  }

  override async mdelete(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.getConnectedClient().del(...prefixedKeys);
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    validateTTL(ttlSeconds);
    const result = await this.getConnectedClient().expire(this.prefixKey(key), ttlSeconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number | null> {
    const result = await this.getConnectedClient().ttl(this.prefixKey(key));
    // Redis returns -2 if key doesn't exist, -1 if no TTL
    if (result === -2) return null;
    return result;
  }

  // ============================================
  // Key Enumeration (SCAN)
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    const client = this.getConnectedClient();
    const prefixedPattern = this.prefixKey(pattern);
    const result: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', prefixedPattern, 'COUNT', 100);
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
    return this.getConnectedClient().incr(this.prefixKey(key));
  }

  async decr(key: string): Promise<number> {
    return this.getConnectedClient().decr(this.prefixKey(key));
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.getConnectedClient().incrby(this.prefixKey(key), amount);
  }

  // ============================================
  // Pub/Sub
  // ============================================

  override supportsPubSub(): boolean {
    return true;
  }

  override async publish(channel: string, message: string): Promise<number> {
    const prefixedChannel = this.prefixKey(channel);
    return this.getConnectedClient().publish(prefixedChannel, message);
  }

  override async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    this.ensureConnected();
    const prefixedChannel = this.prefixKey(channel);

    // Create subscriber connection if needed
    if (!this.subscriber) {
      await this.createSubscriber();
    }

    const subscriber = this.getConnectedSubscriber();

    // Track handlers
    if (!this.subscriptionHandlers.has(prefixedChannel)) {
      this.subscriptionHandlers.set(prefixedChannel, new Set());
      await subscriber.subscribe(prefixedChannel);
    }
    const handlers = this.subscriptionHandlers.get(prefixedChannel);
    if (handlers) {
      handlers.add(handler);
    }

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

    const config = this.options.config;
    if (!config) {
      throw new StorageConfigError('redis', 'Redis config is required when URL is not provided');
    }
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
    let subscriber: Redis;

    if (this.options.url) {
      subscriber = new RedisClass(this.options.url);
    } else if (this.options.config) {
      subscriber = new RedisClass(this.buildRedisOptions());
    } else if (this.options.client) {
      // Duplicate the client for subscriber
      subscriber = (this.options.client as Redis).duplicate();
    } else {
      throw new StorageConfigError('redis', 'Cannot create subscriber without url, config, or client');
    }

    // Set up message handler before assigning to instance
    subscriber.on('message', (channel: string, message: string) => {
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

    this.subscriber = subscriber;
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
