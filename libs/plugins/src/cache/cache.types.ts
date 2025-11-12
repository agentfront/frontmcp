import {Redis as RedisClient} from 'ioredis';

declare global {
  interface ExtendFrontMcpToolMetadata {
    cache?: CachePluginToolOptions | true;
  }
}

export interface CachePluginToolOptions {
  /**
   * Time to live in seconds. Default is 1 day.
   */
  ttl?: number; // default 1 day

  /**
   * If true, the cache value will be updated with the new value after the TTL.
   * Default is false.
   */
  slideWindow?: boolean;
}

export interface BaseCachePluginOptions {
  defaultTTL?: number; // default 1 day
}

export interface RedisClientCachePluginOptions extends BaseCachePluginOptions {
  type: 'redis-client';
  client: RedisClient;
}

export interface RedisCachePluginOptions extends BaseCachePluginOptions {
  type: 'redis';
  config: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
}

export type MemoryCachePluginOptions = BaseCachePluginOptions & {
  type: 'memory';
};

export type RedisCacheOptions = RedisClientCachePluginOptions | RedisCachePluginOptions;

export type CachePluginOptions = MemoryCachePluginOptions | RedisCacheOptions;

export interface CacheStoreInterface {
  setValue(key: string, value: any, ttlSeconds?: number): Promise<void>;

  getValue<T = any>(key: string, defaultValue?: T): Promise<T | undefined>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  close(): Promise<void>;
}
