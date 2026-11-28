// common/types/options/redis/interfaces.ts
// Explicit TypeScript interfaces for Redis/storage configuration

import type { RedisClientInput, RedisClusterConfig, RedisClusterNode, RedisClusterOption } from '@frontmcp/utils';

/**
 * Supported storage providers.
 */
export type StorageProvider = 'redis' | 'vercel-kv';

/**
 * Common options shared between providers.
 */
export interface CommonStorageOptionsInterface {
  /**
   * Key prefix for all keys.
   * @default 'mcp:'
   */
  keyPrefix?: string;

  /**
   * Default TTL in milliseconds for stored data.
   * @default 3600000 (1 hour)
   */
  defaultTtlMs?: number;
}

/**
 * Redis-specific connection options.
 */
export interface RedisConnectionInterface {
  /**
   * Redis host.
   */
  host: string;

  /**
   * Redis port.
   * @default 6379
   */
  port?: number;

  /**
   * Redis password (optional).
   */
  password?: string;

  /**
   * Redis database number.
   * @default 0
   */
  db?: number;

  /**
   * Enable TLS connection.
   * @default false
   */
  tls?: boolean;

  /**
   * The host is a Redis Cluster endpoint, such as an AWS ElastiCache configuration endpoint:
   * `true`, or `{ nodes, options }` to name seed nodes or tune the ioredis Cluster. A cluster has
   * database 0 only.
   *
   * @example `{ host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com', tls: true, cluster: true }`
   */
  cluster?: RedisClusterOption;

  /**
   * Not set with `host` — a config with a `url` is a {@link RedisUrlOptionsInterface}.
   */
  url?: undefined;

  /** Not set with `host` — a client you made is a {@link RedisClientOptionsInterface}. */
  client?: undefined;
}

/**
 * Full Redis provider configuration.
 */
export interface RedisProviderOptionsInterface extends CommonStorageOptionsInterface, RedisConnectionInterface {
  /**
   * Storage provider type.
   */
  provider: 'redis';
}

/**
 * Redis configured from a connection URL — `redis://[[user]:password@]host[:port][/db]`,
 * or `rediss://` for TLS. The URL is read into `host` / `port` / `password` /
 * `db` / `tls` when the config is parsed, so every consumer sees the same
 * connection whichever way it was written.
 *
 * The URL is the base. Connection fields written beside it only fill in what
 * the URL leaves out (`{ url: 'redis://cache:6379', password }` adds the
 * password); a field that contradicts the URL fails validation.
 */
export interface RedisUrlOptionsInterface
  extends CommonStorageOptionsInterface,
    Partial<Omit<RedisConnectionInterface, 'url'>> {
  /**
   * Storage provider type. Optional — a `url` already says Redis.
   */
  provider?: 'redis';

  /**
   * Redis connection URL, e.g. `process.env.REDIS_URL`. The user part may be
   * empty or `default` (ACL users other than `default` are not supported).
   */
  url: string;
}

/**
 * A Redis Cluster named by its seed nodes alone. One reachable node is enough; the rest are
 * discovered. Parsed into the host form, with the first seed node as `host`/`port`.
 */
export interface RedisClusterNodesOptionsInterface extends CommonStorageOptionsInterface {
  /** Storage provider type. Optional. */
  provider?: 'redis';
  /** The seed nodes (`{ host, port }`, `'host:port'` or a `redis://` URL), and ioredis ClusterOptions. */
  cluster: RedisClusterConfig & { nodes: RedisClusterNode[] };
  /** The password of every node. */
  password?: string;
  /** A cluster has database 0 only. */
  db?: number;
  /** Connect to every node over TLS. */
  tls?: boolean;
  host?: undefined;
  port?: undefined;
  url?: undefined;
  client?: undefined;
}

/**
 * A Redis client you made: an ioredis `Redis` or `Cluster`, a node-redis client or cluster
 * (`createClient()` / `createCluster()`), or an object implementing `FrontMcpRedisClient`.
 * FrontMCP runs its commands on it, opens copies of it for pub/sub (which it closes), and never
 * closes it: you do, after the server stops. Nothing about the connection goes beside it.
 */
export interface RedisClientOptionsInterface extends CommonStorageOptionsInterface {
  /** Storage provider type. Optional. */
  provider?: 'redis';
  /** The client. */
  client: RedisClientInput;
  host?: undefined;
  port?: undefined;
  password?: undefined;
  db?: undefined;
  tls?: undefined;
  url?: undefined;
  cluster?: undefined;
}

/**
 * Vercel KV provider configuration.
 * Uses environment variables by default (KV_REST_API_URL, KV_REST_API_TOKEN).
 */
export interface VercelKvProviderOptionsInterface extends CommonStorageOptionsInterface {
  /**
   * Storage provider type.
   */
  provider: 'vercel-kv';

  /**
   * KV REST API URL.
   * @default process.env.KV_REST_API_URL
   */
  url?: string;

  /**
   * KV REST API Token.
   * @default process.env.KV_REST_API_TOKEN
   */
  token?: string;
}

/**
 * Combined Redis options type (union of all provider types).
 */
export type RedisOptionsInterface =
  | RedisProviderOptionsInterface
  | VercelKvProviderOptionsInterface
  | RedisUrlOptionsInterface
  | RedisClusterNodesOptionsInterface
  | RedisClientOptionsInterface
  | (RedisConnectionInterface & CommonStorageOptionsInterface);

/**
 * Pub/Sub options type (Redis-only, no Vercel KV support).
 */
export type PubsubOptionsInterface =
  | RedisProviderOptionsInterface
  | RedisUrlOptionsInterface
  | RedisClusterNodesOptionsInterface
  | RedisClientOptionsInterface
  | (RedisConnectionInterface & CommonStorageOptionsInterface);
