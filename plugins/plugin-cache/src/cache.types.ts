import { Redis as RedisClient } from 'ioredis';

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
  /**
   * Default time to live in seconds. Default is 1 day (86400 seconds).
   */
  defaultTTL?: number;

  /**
   * Tool names or glob patterns to cache.
   * Supports exact names ('tool-name') and wildcards ('namespace:*').
   * Tools matching these patterns use defaultTTL unless they have custom cache metadata.
   *
   * @example
   * ```typescript
   * toolPatterns: ['mintlify:*', 'local:ping', 'api:get-*']
   * ```
   */
  toolPatterns?: string[];

  /**
   * HTTP header name that clients can send to bypass cache for a specific request.
   * When this header is present with a truthy value ('true' or '1'), cache read/write is skipped.
   *
   * Note: Headers must use the `x-frontmcp-*` prefix to be captured by the context storage.
   * Custom bypass headers should also follow this convention.
   *
   * @default 'x-frontmcp-disable-cache'
   *
   * @example
   * ```typescript
   * // Plugin config with custom bypass header
   * CachePlugin.init({ type: 'memory', bypassHeader: 'x-frontmcp-no-cache' })
   *
   * // Client request with header
   * fetch('/mcp', { headers: { 'x-frontmcp-disable-cache': 'true' } })
   * // or
   * fetch('/mcp', { headers: { 'x-frontmcp-disable-cache': '1' } })
   * ```
   */
  bypassHeader?: string;

  /**
   * Include the caller's identity in the cache key.
   *
   * On by default (GHSA-r6v6-p4r8-p936). Most cached tools return something that depends on
   * who is asking, and a key built only from the tool and its arguments serves the first
   * caller's response to everyone else.
   *
   * Set this to `false` ONLY for a cache whose entries are identical for every caller --
   * public reference data, a currency table, a static document. Anything derived from the
   * caller's own permissions, tenant or account must leave it on.
   *
   * @default true
   */
  keyByIdentity?: boolean;
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

/**
 * Use global store configuration from @FrontMcp decorator.
 * Requires `redis` to be configured in the main FrontMcp options.
 * Supports both Redis and Vercel KV global configurations.
 *
 * @example
 * ```typescript
 * // In main.ts - configure global store
 * @FrontMcp({
 *   redis: { host: 'localhost', port: 6379 },
 *   apps: [MyApp]
 * })
 *
 * // In app - use global store
 * @App({
 *   plugins: [CachePlugin.init({ type: 'global-store' })]
 * })
 * class MyApp {}
 * ```
 */
export interface GlobalStoreCachePluginOptions extends BaseCachePluginOptions {
  type: 'global-store';
}

export type RedisCacheOptions = RedisClientCachePluginOptions | RedisCachePluginOptions;

export type CachePluginOptions = MemoryCachePluginOptions | RedisCacheOptions | GlobalStoreCachePluginOptions;

export interface CacheStoreInterface {
  setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void>;

  getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  close(): Promise<void>;
}
