import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData } from './adapter.interface';
import { BaseStorageAdapter } from './base.adapter';

/**
 * Redis client interface (compatible with ioredis, redis, etc.)
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void | string>;
  setex(key: string, seconds: number, value: string): Promise<void | string>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}

/**
 * Configuration for Redis storage adapter
 */
export interface RedisStorageConfig extends StorageAdapterConfig {
  /**
   * Redis client instance
   */
  client: RedisClient;

  /**
   * TTL for cached data in seconds
   * @default 86400 (24 hours)
   */
  ttl?: number;

  /**
   * Key prefix for Redis keys
   * @default 'vectoriadb'
   */
  keyPrefix?: string;
}

/**
 * Redis-based storage adapter
 * Stores embeddings in Redis for distributed caching
 * Perfect for multi-pod environments to share embeddings
 */
export class RedisStorageAdapter<T extends DocumentMetadata = DocumentMetadata> extends BaseStorageAdapter<T> {
  private redisConfig: Required<Pick<RedisStorageConfig, 'client' | 'ttl' | 'keyPrefix'>>;
  private redisKey: string;

  constructor(config: RedisStorageConfig) {
    super(config);

    this.redisConfig = {
      client: config.client,
      ttl: config.ttl ?? 86400, // 24 hours default
      keyPrefix: config.keyPrefix ?? 'vectoriadb',
    };

    this.redisKey = `${this.redisConfig.keyPrefix}:${this.config.namespace}`;
  }

  override async initialize(): Promise<void> {
    // Test Redis connection
    try {
      await this.redisConfig.client.ping();
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async load(): Promise<StoredData<T> | null> {
    try {
      const content = await this.redisConfig.client.get(this.redisKey);
      if (!content) {
        return null;
      }

      return this.safeJsonParse<StoredData<T>>(content);
    } catch (error) {
      // Redis error or invalid JSON
      return null;
    }
  }

  override async save(data: StoredData<T>): Promise<void> {
    try {
      const content = this.safeJsonStringify(data);
      if (!content) {
        throw new Error('Failed to serialize embeddings data');
      }

      // Use SETEX to set with TTL
      await this.redisConfig.client.setex(this.redisKey, this.redisConfig.ttl, content);
    } catch (error) {
      throw new Error(`Failed to save embeddings to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async clear(): Promise<void> {
    try {
      await this.redisConfig.client.del(this.redisKey);
    } catch {
      // Key doesn't exist, ignore
    }
  }

  override async close(): Promise<void> {
    // Optionally quit the Redis connection
    // Note: This might close the connection for other parts of the app
    // Users should manage the Redis client lifecycle themselves
    try {
      await this.redisConfig.client.quit();
    } catch {
      // Ignore errors on close
    }
  }
}
