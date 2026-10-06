/**
 * Redis Storage Adapter
 *
 * Redis-based storage implementation for production use.
 * Uses ioredis with dynamic import for browser compatibility.
 */

import { StorageConfigError, StorageConnectionError } from '../errors';
import { attachRedisErrorListener, type RedisErrorListenerOptions } from '../redis-error-listener';
import {
  describeRedisUrlConflicts,
  mergeRedisUrlFields,
  type RedisUrlMerge,
  type RedisUrlSiblingFields,
} from '../redis-url';
import type { MessageHandler, RedisAdapterOptions, SetOptions, Unsubscribe } from '../types';
import { validateTTL } from '../utils';
import { COMPARE_AND_DELETE_SCRIPT } from '../utils/compare-and-delete';
import { BaseStorageAdapter } from './base';

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
        { cause: error },
      );
    }

    throw new Error('ioredis is required for Redis storage adapter. Install it with: npm install ioredis', {
      cause: error,
    });
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
  private detachErrorListener?: () => void;
  private connecting?: Promise<void>;
  private readonly keyPrefix: string;
  private readonly subscriptionHandlers = new Map<string, Set<MessageHandler>>();
  private readonly connectionUrl?: string;
  private readonly urlFillIns: RedisUrlMerge['fillIns'];

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
    const configUrl = options.config?.url;
    this.connectionUrl = options.url ?? (typeof configUrl === 'string' ? configUrl : undefined);
    this.urlFillIns = this.connectionUrl ? resolveUrlFillIns(this.connectionUrl, options) : {};
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    // Concurrent callers share one attempt: each attempt makes its own client, and a failing one
    // must only ever tear down the client it made.
    this.connecting ??= this.openConnection().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    // While connecting, an owned client's socket errors are recorded rather than
    // left to ioredis's "Unhandled error event" logger: the ping only reports
    // that its retries ran out, and the socket error says why.
    let socketError: Error | undefined;
    const recordSocketError = (error: Error): void => {
      socketError = error;
    };

    let client: Redis | undefined;
    try {
      if (this.options.client) {
        // Use external client
        client = this.options.client as Redis;
      } else {
        // Create new client
        const RedisClass = getRedisClass();
        if (this.connectionUrl) {
          client = new RedisClass(this.connectionUrl, this.buildRedisOptions());
        } else {
          client = new RedisClass(this.buildRedisOptions());
        }
        client.on('error', recordSocketError);
      }

      // Test connection
      await client.ping();
      this.client = client;
      this.connected = true;
      if (this.ownsClient) {
        client.removeListener('error', recordSocketError);
        // A later outage makes ioredis emit 'error' on every reconnect attempt; without a
        // listener each one is printed as "Unhandled error event".
        this.detachErrorListener = attachRedisErrorListener(client, { label: 'RedisStorage' });
      }
    } catch (e) {
      // A client this adapter created keeps reconnecting in the background
      // unless it is torn down, and `disconnect()` is a no-op while
      // `connected` is false — so close it here. An external client belongs to
      // the caller and is left as it was.
      if (this.ownsClient && client) {
        try {
          client.disconnect();
        } catch {
          // The client never came up; there is nothing left to close.
        }
      }
      const cause = socketError ?? (e instanceof Error ? e : undefined);
      throw new StorageConnectionError('Failed to connect to Redis', cause, 'redis');
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

    this.detachErrorListener?.();
    this.detachErrorListener = undefined;
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

  override async deleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
    const deleted = await this.getConnectedClient().eval(
      COMPARE_AND_DELETE_SCRIPT,
      1,
      this.prefixKey(key),
      expectedValue,
    );
    return deleted === 1;
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
    if (this.connectionUrl) {
      return { ...toFillInOptions(this.urlFillIns), lazyConnect: false, maxRetriesPerRequest: 3 };
    }

    const config = this.options.config;
    if (!config || typeof config.url === 'string' || config.host === undefined) {
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

    if (this.connectionUrl) {
      subscriber = new RedisClass(this.connectionUrl, this.buildRedisOptions());
    } else if (this.options.config) {
      subscriber = new RedisClass(this.buildRedisOptions());
    } else if (this.options.client) {
      // Duplicate the client for subscriber
      subscriber = (this.options.client as Redis).duplicate();
    } else {
      throw new StorageConfigError('redis', 'Cannot create subscriber without url, config, or client');
    }

    attachRedisErrorListener(subscriber, { label: 'RedisStorage:subscriber' });

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

function resolveUrlFillIns(connectionUrl: string, options: RedisAdapterOptions): RedisUrlMerge['fillIns'] {
  const { url: configUrl, ...siblingFields } = { url: undefined, ...options.config };
  if (options.url && configUrl && configUrl !== options.url) {
    throw new StorageConfigError('redis', 'redis.url and redis.config.url name different servers; set one of them.');
  }
  return checkedUrlFillIns(connectionUrl, siblingFields);
}

/** The fields beside a url fill in what it leaves out; one that contradicts it throws a StorageConfigError. */
function checkedUrlFillIns(url: string, fields: RedisUrlSiblingFields): RedisUrlMerge['fillIns'] {
  const merge = mergeRedisUrlFields(url, fields);
  if (merge && merge.conflicts.length > 0) {
    throw new StorageConfigError('redis', describeRedisUrlConflicts(merge.conflicts));
  }
  return merge?.fillIns ?? {};
}

/** ioredis keeps what a URL states and takes only the missing fields from these options. */
function toFillInOptions({ port, password, db, tls }: RedisUrlMerge['fillIns']): RedisOptions {
  return {
    ...(port !== undefined ? { port } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(tls ? { tls: {} } : {}),
  };
}

export interface CreateRedisClientOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  /** Prefix for the rate-limited connection-error log line. */
  label?: string;
  logger?: RedisErrorListenerOptions['logger'];
}

/**
 * Create a plain ioredis client that reconnects on its own and never emits an unhandled
 * 'error' event. The caller owns the client and must `quit()`/`disconnect()` it.
 *
 * With a `url`, the other connection fields fill in only what the URL leaves out (port,
 * password, db, tls), and one that contradicts it throws a `StorageConfigError`.
 */
export function createRedisClient(options: CreateRedisClientOptions): Redis {
  const urlOptions = options.url ? toFillInOptions(checkedUrlFillIns(options.url, options)) : undefined;
  const RedisClass = getRedisClass();
  const baseOptions: RedisOptions = { lazyConnect: false, maxRetriesPerRequest: 3 };
  const client = options.url
    ? new RedisClass(options.url, { ...baseOptions, ...urlOptions })
    : new RedisClass({
        ...baseOptions,
        host: options.host ?? 'localhost',
        port: options.port ?? 6379,
        password: options.password,
        db: options.db ?? 0,
        tls: options.tls ? {} : undefined,
      });
  attachRedisErrorListener(client, { label: options.label ?? 'redis', logger: options.logger });
  return client;
}
