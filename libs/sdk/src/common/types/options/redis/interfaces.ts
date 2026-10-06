// common/types/options/redis/interfaces.ts
// Explicit TypeScript interfaces for Redis/storage configuration

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
   * Not set with `host` — a config with a `url` is a {@link RedisUrlOptionsInterface}.
   */
  url?: undefined;
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
  | (RedisConnectionInterface & CommonStorageOptionsInterface);

/**
 * Pub/Sub options type (Redis-only, no Vercel KV support).
 */
export type PubsubOptionsInterface =
  | RedisProviderOptionsInterface
  | RedisUrlOptionsInterface
  | (RedisConnectionInterface & CommonStorageOptionsInterface);
