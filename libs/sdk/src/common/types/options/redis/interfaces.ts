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
  | (RedisConnectionInterface & CommonStorageOptionsInterface);
