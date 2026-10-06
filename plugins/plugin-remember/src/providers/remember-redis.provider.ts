import Redis, { type Redis as RedisClient } from 'ioredis';

import { Provider, ProviderScope } from '@frontmcp/sdk';

import type { RedisClientRememberPluginOptions, RedisRememberPluginOptions } from '../remember.types';
import { callerKeyOf, doubledPrefixKey, prefixedStoreKey } from './remember-key-prefix';
import type { RememberStoreInterface } from './remember-store.interface';

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
   * Prefix prepended to Redis keys that don't already start with it.
   * Include any separator (e.g., "myapp:" or "user:123:") as part of the prefix.
   */
  private readonly keyPrefix: string;
  /** TTL in seconds for values stored without one. */
  private readonly defaultTTL?: number;
  /** True if this provider created the client (and should close it), false if externally provided */
  private readonly ownsClient: boolean;

  constructor(options: RedisRememberOptions) {
    this.keyPrefix = options.keyPrefix ?? '';
    this.defaultTTL = options.defaultTTL;

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

    const fullKey = prefixedStoreKey(this.keyPrefix, key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;

    if (ttl !== undefined && ttl > 0) {
      await this.client.set(fullKey, strValue, 'EX', ttl);
    } else {
      await this.client.set(fullKey, strValue);
    }
    await this.deleteDoubledPrefixKey(key);
  }

  /**
   * Store a value only if the key is absent, via Redis `SET ... NX`.
   *
   * `set` resolves to `'OK'` when it created the key and `null` when the key already existed,
   * so the whole check-and-write is one round trip and two callers racing cannot both win.
   */
  async setIfAbsent(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const fullKey = prefixedStoreKey(this.keyPrefix, key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;

    const result =
      ttl !== undefined && ttl > 0
        ? await this.client.set(fullKey, strValue, 'EX', ttl, 'NX')
        : await this.client.set(fullKey, strValue, 'NX');

    return result === 'OK';
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
    const raw =
      (await this.client.get(prefixedStoreKey(this.keyPrefix, key))) ?? (await this.takeDoubledPrefixValue(key));

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
    await this.client.del(prefixedStoreKey(this.keyPrefix, key));
    await this.deleteDoubledPrefixKey(key);
  }

  /**
   * Check if a key exists.
   */
  async exists(key: string): Promise<boolean> {
    if ((await this.client.exists(prefixedStoreKey(this.keyPrefix, key))) === 1) return true;
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    return doubledKey !== undefined && (await this.client.exists(doubledKey)) === 1;
  }

  /**
   * List keys matching a pattern.
   * Uses Redis SCAN for efficient iteration.
   */
  async keys(pattern = '*'): Promise<string[]> {
    const result = new Set<string>();
    for (const key of await this.scan(prefixedStoreKey(this.keyPrefix, pattern))) {
      result.add(callerKeyOf(this.keyPrefix, pattern, key));
    }
    const doubledPattern = doubledPrefixKey(this.keyPrefix, pattern);
    if (doubledPattern) {
      for (const key of await this.scan(doubledPattern)) result.add(key.slice(this.keyPrefix.length));
    }
    return [...result];
  }

  private async scan(match: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = nextCursor;
      found.push(...keys);
    } while (cursor !== '0');
    return found;
  }

  /** Moves an entry from the key releases up to 1.9.1 wrote it under, keeping its TTL; its stored text, or null. */
  private async takeDoubledPrefixValue(key: string): Promise<string | null> {
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    if (!doubledKey) return null;
    const raw = await this.client.get(doubledKey);
    if (raw === null) return null;

    const fullKey = prefixedStoreKey(this.keyPrefix, key);
    const ttlMs = await this.client.pttl(doubledKey);
    if (ttlMs > 0) {
      await this.client.set(fullKey, raw, 'PX', ttlMs, 'NX');
    } else {
      await this.client.set(fullKey, raw, 'NX');
    }
    await this.client.del(doubledKey);
    return (await this.client.get(fullKey)) ?? raw;
  }

  /** Drops what releases up to 1.9.1 left under the doubled key, so it cannot come back once this key is gone. */
  private async deleteDoubledPrefixKey(key: string): Promise<void> {
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    if (doubledKey) await this.client.del(doubledKey);
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
