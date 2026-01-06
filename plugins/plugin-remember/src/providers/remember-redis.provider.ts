import Redis, { Redis as RedisClient } from 'ioredis';
import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { RememberStoreInterface } from './remember-store.interface';
import type { RedisRememberPluginOptions, RedisClientRememberPluginOptions } from '../remember.types';

/**
 * Combined options type for Redis provider.
 */
export type RedisRememberOptions = RedisRememberPluginOptions | RedisClientRememberPluginOptions;

/**
 * Redis storage provider for RememberPlugin.
 * Provides persistent, distributed storage with native TTL support.
 */
@Provider({
  name: 'provider:remember:redis',
  description: 'Redis-based storage provider for RememberPlugin',
  scope: ProviderScope.GLOBAL,
})
export default class RememberRedisProvider implements RememberStoreInterface {
  private readonly client: RedisClient;
  /**
   * Prefix prepended to all Redis keys.
   * Include any separator (e.g., "myapp:" or "user:123:") as part of the prefix.
   */
  private readonly keyPrefix: string;
  /** True if this provider created the client (and should close it), false if externally provided */
  private readonly ownsClient: boolean;

  constructor(options: RedisRememberOptions) {
    this.keyPrefix = options.keyPrefix ?? '';

    if (options.type === 'redis-client') {
      this.client = options.client;
      this.ownsClient = false;
      return;
    }

    this.ownsClient = true;

    this.client = new Redis({
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      ...options.config,
    });

    this.client.on('connect', () => {
      // Silent connect - log only in debug mode (strict check for 'true')
      if (process.env['DEBUG'] === 'true') {
        console.log('[RememberPlugin:Redis] Connected');
      }
    });

    this.client.on('error', (err) => {
      console.error('[RememberPlugin:Redis] Error:', err.message);
    });
  }

  /**
   * Store a value with optional TTL.
   *
   * @param key - The key to store under
   * @param value - The value to store (must not be undefined)
   * @param ttlSeconds - Optional TTL in seconds (must be positive integer if provided)
   * @throws Error if value is undefined or ttlSeconds is invalid
   */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    // Validate value is not undefined (JSON.stringify(undefined) returns undefined, not a string)
    if (value === undefined) {
      throw new Error('Cannot store undefined value. Use null or delete the key instead.');
    }

    // Validate ttlSeconds if provided
    if (ttlSeconds !== undefined) {
      if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
        throw new Error(`Invalid TTL: expected a number, got ${typeof ttlSeconds}`);
      }
      if (ttlSeconds <= 0) {
        throw new Error(`Invalid TTL: must be positive, got ${ttlSeconds}`);
      }
      if (!Number.isInteger(ttlSeconds)) {
        throw new Error(`Invalid TTL: must be an integer, got ${ttlSeconds}`);
      }
    }

    const fullKey = this.keyPrefix + key;
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);

    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(fullKey, strValue, 'EX', ttlSeconds);
    } else {
      await this.client.set(fullKey, strValue);
    }
  }

  /**
   * Retrieve a value by key.
   *
   * Returns the parsed JSON value if successful, or `defaultValue` if:
   * - The key does not exist
   * - The stored value is not valid JSON (malformed or legacy data)
   *
   * @param key - The key to retrieve
   * @param defaultValue - Value to return if key doesn't exist or parsing fails
   * @returns The parsed value as T, or defaultValue/undefined
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const fullKey = this.keyPrefix + key;
    const raw = await this.client.get(fullKey);

    if (raw === null) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Return defaultValue for malformed/legacy data rather than unsafe cast
      return defaultValue;
    }
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.keyPrefix + key;
    await this.client.del(fullKey);
  }

  /**
   * Check if a key exists.
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    return (await this.client.exists(fullKey)) === 1;
  }

  /**
   * List keys matching a pattern.
   * Uses Redis SCAN for efficient iteration.
   */
  async keys(pattern?: string): Promise<string[]> {
    const searchPattern = this.keyPrefix + (pattern ?? '*');
    const result: string[] = [];

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', searchPattern, 'COUNT', 100);
      cursor = nextCursor;

      // Strip prefix from keys
      for (const key of keys) {
        result.push(key.slice(this.keyPrefix.length));
      }
    } while (cursor !== '0');

    return result;
  }

  /**
   * Gracefully close the Redis connection.
   * Only closes if this provider owns the client (created it internally).
   * Externally-provided clients are left open for the caller to manage.
   */
  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.client.quit();
    }
  }
}
