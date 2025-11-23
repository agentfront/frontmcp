import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData } from './adapter.interface';
import { BaseStorageAdapter } from './base.adapter';
import { ConfigurationError, StorageError } from '../errors';

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

    // Sanitize namespace to prevent Redis command injection
    const sanitizedNamespace = this.sanitizeNamespace(this.config.namespace);
    const sanitizedKeyPrefix = this.sanitizeNamespace(this.redisConfig.keyPrefix);

    this.redisKey = `${sanitizedKeyPrefix}:${sanitizedNamespace}`;
  }

  /**
   * Sanitize namespace/key prefix to prevent Redis command injection
   * Removes dangerous characters like newlines, carriage returns, and other control characters
   * @private
   */
  private sanitizeNamespace(namespace: string): string {
    if (!namespace || typeof namespace !== 'string') {
      throw new ConfigurationError('Namespace must be a non-empty string');
    }

    // Remove newlines, carriage returns, and other control characters
    // These could be used for command injection in Redis
    const sanitized = namespace
      // eslint-disable-next-line no-control-regex
      .replace(/[\r\n\t\0\u000B\u000C]/g, '') // Remove control characters
      .replace(/[^\w:.-]/g, '-') // Replace unsafe chars with dash (allow word chars, colon, dot, dash)
      .replace(/^[.-]+/, '') // Remove leading dots and dashes
      .replace(/[.-]+$/, '') // Remove trailing dots and dashes
      .substring(0, 200); // Limit length

    if (!sanitized) {
      throw new ConfigurationError('Namespace becomes empty after sanitization');
    }

    return sanitized;
  }

  override async initialize(): Promise<void> {
    // Test Redis connection
    try {
      await this.redisConfig.client.ping();
    } catch (error) {
      throw new StorageError(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  override async load(): Promise<StoredData<T> | null> {
    try {
      const content = await this.redisConfig.client.get(this.redisKey);
      if (!content) {
        return null;
      }

      return this.safeJsonParse<StoredData<T>>(content);
    } catch {
      // Redis error or invalid JSON
      return null;
    }
  }

  override async save(data: StoredData<T>): Promise<void> {
    try {
      const content = this.safeJsonStringify(data);
      if (!content) {
        throw new StorageError('Failed to serialize embeddings data');
      }

      // Use SETEX to set with TTL
      await this.redisConfig.client.setex(this.redisKey, this.redisConfig.ttl, content);
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to save embeddings to Redis: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
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
    // No-op: Users manage the Redis client lifecycle themselves
    // The client is externally owned and may be shared across the application
  }
}
