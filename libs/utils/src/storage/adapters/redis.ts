/**
 * Redis Storage Adapter
 *
 * Redis-based storage implementation for production use: a single node, a Redis Cluster, or a
 * client the application made (ioredis or node-redis). ioredis is required only when a client is
 * opened, for browser compatibility.
 */

import { StorageConfigError, StorageConnectionError } from '../errors';
import {
  deleteRedisKeys,
  getRedisKeys,
  isRedisClusterClient,
  publishRedisMessage,
  scanRedisKeys,
} from '../redis-client/cluster-ops';
import { hasRedisClusterNodes } from '../redis-client/config';
import { adoptRedisClient, createRedisConnection, urlConnectionOptions } from '../redis-client/connection';
import type { FrontMcpRedisClient, RedisConnectionSettings } from '../redis-client/types';
import { attachRedisErrorListener, type RedisErrorListenerOptions } from '../redis-error-listener';
import type { MessageHandler, RedisAdapterOptions, SetOptions, Unsubscribe } from '../types';
import { validateTTL } from '../utils';
import {
  COMPARE_AND_DELETE_SCRIPT,
  COMPARE_AND_EXPIRE_SCRIPT,
  COMPARE_AND_SET_SCRIPT,
  EXTEND_TTL_SCRIPT,
} from '../utils/compare-and-delete';
import { BaseStorageAdapter } from './base';

// Type imports for ioredis (dynamic import at runtime)
type Redis = import('ioredis').Redis;

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

  private client?: FrontMcpRedisClient;
  private subscriber?: FrontMcpRedisClient;
  private readonly options: RedisAdapterOptions;
  private readonly ownsClient: boolean;
  private detachErrorListener?: () => void;
  private connecting?: Promise<void>;
  private readonly keyPrefix: string;
  private readonly subscriptionHandlers = new Map<string, Set<MessageHandler>>();
  private readonly reconnectListeners = new Set<() => void>();
  private readonly connectionUrl?: string;

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
    // A url and a field that contradict each other fail here, not on the first connect
    if (this.connectionUrl) validateUrlFields(this.connectionUrl, options);
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

    let client: FrontMcpRedisClient | undefined;
    try {
      if (this.options.client) {
        // An external client (ioredis Redis/Cluster, node-redis, or a FrontMcpRedisClient); never closed here
        client = adoptRedisClient(this.options.client as object).client;
      } else {
        client = this.newClient();
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
  private getConnectedClient(): FrontMcpRedisClient {
    this.ensureConnected();
    if (!this.client) {
      throw new StorageConnectionError('Redis client not connected', undefined, 'redis');
    }
    return this.client;
  }

  /**
   * Get the connected Redis subscriber, throwing if not created.
   */
  private getConnectedSubscriber(): FrontMcpRedisClient {
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

  override async extendTtl(key: string, ttlSeconds: number): Promise<boolean> {
    validateTTL(ttlSeconds);
    const extended = await this.getConnectedClient().eval(
      EXTEND_TTL_SCRIPT,
      1,
      this.prefixKey(key),
      String(ttlSeconds),
    );
    return extended === 1;
  }

  override async expireIfEquals(key: string, expectedValue: string, ttlSeconds: number): Promise<boolean> {
    validateTTL(ttlSeconds);
    const extended = await this.getConnectedClient().eval(
      COMPARE_AND_EXPIRE_SCRIPT,
      1,
      this.prefixKey(key),
      expectedValue,
      String(ttlSeconds),
    );
    return extended === 1;
  }

  override async setIfEquals(key: string, expectedValue: string, value: string): Promise<boolean> {
    const stored = await this.getConnectedClient().eval(
      COMPARE_AND_SET_SCRIPT,
      1,
      this.prefixKey(key),
      expectedValue,
      value,
    );
    return stored === 1;
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
    // One MGET on a single node; one GET per key on a cluster, whose keys span hash slots
    return getRedisKeys(this.getConnectedClient(), prefixedKeys);
  }

  override async mset(entries: import('../types').SetEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Validate all entries first
    for (const entry of entries) {
      this.validateSetOptions(entry.options);
    }

    const client = this.getConnectedClient();
    const commands = entries.map(
      (entry) => [this.prefixKey(entry.key), entry.value, ...setArguments(entry.options)] as const,
    );

    // A cluster pipeline refuses keys of different slots, so a cluster gets the SETs one by one, in
    // parallel (the pipeline was never atomic either)
    if (isRedisClusterClient(client) || typeof client.pipeline !== 'function') {
      await Promise.all(commands.map(([key, value, ...args]) => client.set(key, value, ...args)));
      return;
    }

    // Use pipeline for efficiency
    const pipeline = client.pipeline();
    for (const [key, value, ...args] of commands) pipeline.set(key, value, ...args);
    await pipeline.exec();
  }

  override async mdelete(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    // One DEL on a single node; one DEL per key on a cluster
    return deleteRedisKeys(this.getConnectedClient(), prefixedKeys);
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
    // SCAN on a single node; SCAN on every master of a cluster
    const keys = await scanRedisKeys(this.getConnectedClient(), this.prefixKey(pattern), 100);
    // Remove prefix from keys
    return keys.map((key) => this.unprefixKey(key));
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
    // On a cluster PUBLISH counts only one node's subscribers; this counts every node's
    return publishRedisMessage(this.getConnectedClient(), prefixedChannel, message);
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

  onPubSubReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * The connection settings of a client this adapter opens: the URL with the config's fields
   * filling in what it leaves out, or the config's host (or its cluster's seed nodes).
   */
  private connectionSettings(): RedisConnectionSettings {
    const config: RedisConnectionSettings = { ...this.options.config };
    const { url: _configUrl, ...fields } = config;
    if (this.connectionUrl) return { ...fields, url: this.connectionUrl };

    if (!this.options.config || (fields.host === undefined && !hasRedisClusterNodes(fields.cluster))) {
      throw new StorageConfigError('redis', 'Redis config is required when URL is not provided');
    }
    return { ...fields, port: fields.port ?? 6379, db: fields.db ?? 0 };
  }

  /**
   * Create a client this adapter owns: an ioredis Redis, or a Cluster with `cluster`. A URL only
   * ioredis reads goes to it as is.
   */
  private newClient(): FrontMcpRedisClient {
    return createRedisConnection({ ...this.connectionSettings(), noErrorListener: true }).client;
  }

  /**
   * Create subscriber connection.
   */
  private async createSubscriber(): Promise<void> {
    let subscriber: FrontMcpRedisClient;

    if (this.connectionUrl || this.options.config) {
      subscriber = this.newClient();
    } else if (this.options.client && this.client) {
      // A copy of the external client for subscribing: this adapter made it, so it closes it
      subscriber = this.client.duplicate();
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

    let readyBefore = false;
    subscriber.on('ready', () => {
      if (readyBefore) {
        for (const listener of [...this.reconnectListeners]) {
          try {
            listener();
          } catch {
            // A listener's failure must not reach ioredis's event loop
          }
        }
      }
      readyBefore = true;
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
   *
   * An ioredis `Redis` for a single node. With a cluster it is an ioredis `Cluster`, and for a client
   * passed in it is that client (a node-redis one behind its {@link FrontMcpRedisClient} adapter), whose
   * `quit()`/`disconnect()` do nothing; both answer the commands of {@link FrontMcpRedisClient}.
   */
  getClient(): Redis | undefined {
    return this.client as Redis | undefined;
  }
}

function validateUrlFields(connectionUrl: string, options: RedisAdapterOptions): void {
  const { url: configUrl, ...siblingFields } = { url: undefined, ...options.config };
  if (options.url && configUrl && configUrl !== options.url) {
    throw new StorageConfigError('redis', 'redis.url and redis.config.url name different servers; set one of them.');
  }
  urlConnectionOptions(connectionUrl, siblingFields);
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
 *
 * @deprecated since 1.14: use `createRedisConnection()`, which takes the same settings plus
 *   `cluster` (a Redis Cluster) and `client` (a client you made), and says who owns the client.
 *   This keeps opening a single-node ioredis `Redis`.
 */
export function createRedisClient(options: CreateRedisClientOptions): Redis {
  const { url, host, port, password, db, tls, label, logger } = options;
  return createRedisConnection({ url, host, port, password, db, tls, label: label ?? 'redis', logger })
    .client as unknown as Redis;
}

/** The arguments after `SET key value` for one write's options: `EX seconds`, then `NX` or `XX`. */
function setArguments(options: SetOptions | undefined): Array<string | number> {
  const args: Array<string | number> = [];
  if (options?.ttlSeconds) args.push('EX', options.ttlSeconds);
  if (options?.ifNotExists) args.push('NX');
  else if (options?.ifExists) args.push('XX');
  return args;
}
