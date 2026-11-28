import { Provider, ProviderScope } from '@frontmcp/sdk';
import { adoptRedisClient, createRedisConnection, type FrontMcpRedisClient } from '@frontmcp/utils';

import { type CacheStoreInterface, type RedisCacheOptions } from '../cache.types';

@Provider({
  name: 'provider:cache:redis',
  description: 'Redis-based cache provider',
  scope: ProviderScope.GLOBAL,
})
export default class CacheRedisProvider implements CacheStoreInterface {
  private readonly client: FrontMcpRedisClient;

  constructor(options: RedisCacheOptions) {
    if (options.type !== 'redis' && options.type !== 'redis-client') {
      throw new Error('Invalid cache provider type');
    }

    if (options.type === 'redis-client') {
      // The app's client (ioredis or node-redis), behind a guard: close() leaves it open
      this.client = adoptRedisClient(options.client as object).client;
      return;
    }
    // ioredis is loaded when a cache on Redis is built, so a page that never builds one does not bundle it.
    // Every config field goes to ioredis as given (a TLS object, keyPrefix); `cluster` opens a Cluster.
    const { host, port, password, db, cluster, ...ioredisOptions } = options.config;
    this.client = createRedisConnection({
      host,
      port,
      password,
      db,
      cluster,
      ioredisOptions,
      noErrorListener: true,
    }).client;

    // TODO: migrate to the storage utils
    this.client.on('connect', () => console.log('[Redis] Connected'));
    this.client.on('error', (err) => console.error('[Redis] Error:', err));
  }

  /** Set a value (auto-stringifies objects) */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, strValue, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, strValue);
    }
  }

  /** Get a value and automatically parse JSON if possible */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === null) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // fallback for plain string values
      return raw as unknown as T;
    }
  }

  /** Delete a key */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /** Gracefully close the Redis connection (a client you passed in stays open: it is yours) */
  async close(): Promise<void> {
    await this.client.quit();
  }
}
