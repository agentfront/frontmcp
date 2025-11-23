import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapter, StorageAdapterConfig, StoredData, StorageMetadata } from './adapter.interface';

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
export class RedisStorageAdapter<T extends DocumentMetadata = DocumentMetadata> implements StorageAdapter<T> {
  private config: Required<RedisStorageConfig>;
  private redisKey: string;

  constructor(config: RedisStorageConfig) {
    this.config = {
      namespace: config.namespace ?? 'default',
      autoSave: config.autoSave ?? false,
      autoSaveInterval: config.autoSaveInterval ?? 60000,
      client: config.client,
      ttl: config.ttl ?? 86400, // 24 hours default
      keyPrefix: config.keyPrefix ?? 'vectoriadb',
    };

    this.redisKey = `${this.config.keyPrefix}:${this.config.namespace}`;
  }

  async initialize(): Promise<void> {
    // Test Redis connection
    try {
      await this.config.client.ping();
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async hasValidCache(metadata: StorageMetadata): Promise<boolean> {
    try {
      const data = await this.load();
      if (!data) {
        return false;
      }

      // Check if version matches
      if (data.metadata.version !== metadata.version) {
        return false;
      }

      // Check if tools hash matches (invalidate if tools changed)
      if (data.metadata.toolsHash !== metadata.toolsHash) {
        return false;
      }

      // Check if model name matches
      if (data.metadata.modelName !== metadata.modelName) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<StoredData<T> | null> {
    try {
      const content = await this.config.client.get(this.redisKey);
      if (!content) {
        return null;
      }

      const data = JSON.parse(content) as StoredData<T>;
      return data;
    } catch (error) {
      // Redis error or invalid JSON
      return null;
    }
  }

  async save(data: StoredData<T>): Promise<void> {
    try {
      const content = JSON.stringify(data);

      // Use SETEX to set with TTL
      await this.config.client.setex(this.redisKey, this.config.ttl, content);
    } catch (error) {
      throw new Error(`Failed to save embeddings to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.config.client.del(this.redisKey);
    } catch {
      // Key doesn't exist, ignore
    }
  }

  async close(): Promise<void> {
    // Optionally quit the Redis connection
    // Note: This might close the connection for other parts of the app
    // Users should manage the Redis client lifecycle themselves
    try {
      await this.config.client.quit();
    } catch {
      // Ignore errors on close
    }
  }
}
