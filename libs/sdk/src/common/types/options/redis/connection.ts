// common/types/options/redis/connection.ts
// From a parsed `redis` option to the connection every Redis-backed feature opens (#1503)

import {
  redisAdapterOptionsOf,
  redisConnectionOf,
  type RedisAdapterOptions,
  type RedisConnectionConfig,
} from '@frontmcp/utils';

import type { PubsubOptions, RedisClientProviderOptions, RedisOptions, RedisProviderOptions } from './schema';

/** A parsed `redis` option that names a Redis server: host/url/cluster, or a client. */
export type RedisConnectionOptions = RedisProviderOptions | RedisClientProviderOptions;

/** Whether a parsed `redis` option names a Redis server (not Vercel KV): host, url, cluster, or a client. */
export function isRedisConnectionOptions(options: RedisOptions | PubsubOptions): options is RedisConnectionOptions {
  return options.provider === 'redis';
}

/**
 * The connection fields of a parsed `redis` option, as `createRedisConnection()` takes them: its
 * host/port/password/db/tls and `cluster`, or its `client` alone. Destructuring `{ host, port, ... }`
 * instead would drop `cluster` and `client`.
 */
export function redisConnectionOfOptions(options: RedisConnectionOptions): RedisConnectionConfig {
  return redisConnectionOf(options as RedisConnectionConfig);
}

/** The `createStorage()` config of a parsed `redis` option. */
export function redisStorageConfigOf(options: RedisConnectionOptions): { type: 'redis'; redis: RedisAdapterOptions } {
  return { type: 'redis', redis: redisAdapterOptionsOf(options as RedisConnectionConfig) };
}
