/**
 * TypedStorage
 *
 * A generic wrapper that provides type-safe JSON serialization
 * on top of StorageAdapter or NamespacedStorage.
 *
 * @example
 * ```typescript
 * import { createStorage } from '@frontmcp/utils/storage';
 *
 * interface User {
 *   id: string;
 *   name: string;
 * }
 *
 * const storage = await createStorage({ type: 'memory' });
 * const users = new TypedStorage<User>(storage);
 *
 * await users.set('user:1', { id: '1', name: 'Alice' });
 * const user = await users.get('user:1');
 * ```
 */

import type { StorageAdapter, NamespacedStorage, SetOptions } from '@frontmcp/utils';
import type { TypedStorageOptions, TypedSetEntry } from './typed-storage.types';

/**
 * TypedStorage provides type-safe JSON serialization on top of StorageAdapter.
 *
 * Features:
 * - Automatic JSON serialization/deserialization
 * - Optional Zod schema validation on read
 * - Custom serializer support
 * - Batch operations (mget/mset)
 * - Full StorageAdapter method access
 */
export class TypedStorage<T> {
  private readonly storage: StorageAdapter | NamespacedStorage;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (raw: string) => unknown;
  private readonly schema?: TypedStorageOptions<T>['schema'];
  private readonly throwOnInvalid: boolean;

  constructor(storage: StorageAdapter | NamespacedStorage, options: TypedStorageOptions<T> = {}) {
    this.storage = storage;
    this.serialize = options.serialize ?? JSON.stringify;
    this.deserialize = options.deserialize ?? JSON.parse;
    this.schema = options.schema;
    this.throwOnInvalid = options.throwOnInvalid ?? false;
  }

  /**
   * Get a typed value by key.
   *
   * @param key - Storage key
   * @returns The typed value, or null if not found or invalid
   */
  async get(key: string): Promise<T | null> {
    const raw = await this.storage.get(key);
    if (raw === null) {
      return null;
    }

    return this.parseValue(raw, key);
  }

  /**
   * Set a typed value with optional TTL.
   *
   * @param key - Storage key
   * @param value - Typed value to store
   * @param options - Optional TTL and conditional flags
   */
  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    const serialized = this.serialize(value);
    await this.storage.set(key, serialized, options);
  }

  /**
   * Delete a key.
   *
   * @param key - Storage key
   * @returns true if key existed and was deleted
   */
  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  /**
   * Check if a key exists.
   *
   * @param key - Storage key
   * @returns true if key exists
   */
  async exists(key: string): Promise<boolean> {
    return this.storage.exists(key);
  }

  /**
   * Get multiple typed values.
   *
   * @param keys - Array of storage keys
   * @returns Array of typed values (null for missing/invalid keys)
   */
  async mget(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    const rawValues = await this.storage.mget(keys);
    return rawValues.map((raw, index) => {
      if (raw === null) {
        return null;
      }
      return this.parseValue(raw, keys[index]);
    });
  }

  /**
   * Set multiple typed values.
   *
   * @param entries - Array of key-value-options entries
   */
  async mset(entries: TypedSetEntry<T>[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const rawEntries = entries.map((entry) => ({
      key: entry.key,
      value: this.serialize(entry.value),
      options: entry.options,
    }));

    await this.storage.mset(rawEntries);
  }

  /**
   * Delete multiple keys.
   *
   * @param keys - Array of storage keys
   * @returns Number of keys actually deleted
   */
  async mdelete(keys: string[]): Promise<number> {
    return this.storage.mdelete(keys);
  }

  /**
   * Update TTL on an existing key.
   *
   * @param key - Storage key
   * @param ttlSeconds - New TTL in seconds
   * @returns true if key exists and TTL was set
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return this.storage.expire(key, ttlSeconds);
  }

  /**
   * Get remaining TTL for a key.
   *
   * @param key - Storage key
   * @returns TTL in seconds, -1 if no TTL, or null if key doesn't exist
   */
  async ttl(key: string): Promise<number | null> {
    return this.storage.ttl(key);
  }

  /**
   * List keys matching a pattern.
   *
   * @param pattern - Glob pattern (default: '*' for all keys)
   * @returns Array of matching keys
   */
  async keys(pattern?: string): Promise<string[]> {
    return this.storage.keys(pattern);
  }

  /**
   * Count keys matching a pattern.
   *
   * @param pattern - Glob pattern (default: '*' for all keys)
   * @returns Number of matching keys
   */
  async count(pattern?: string): Promise<number> {
    return this.storage.count(pattern);
  }

  /**
   * Get the underlying storage adapter.
   * Use with caution - operations bypass type safety.
   */
  get raw(): StorageAdapter | NamespacedStorage {
    return this.storage;
  }

  /**
   * Parse and validate a raw value.
   */
  private parseValue(raw: string, key: string): T | null {
    try {
      const parsed = this.deserialize(raw);

      if (this.schema) {
        const result = this.schema.safeParse(parsed);
        if (!result.success) {
          if (this.throwOnInvalid) {
            throw new Error(`TypedStorage validation failed for key "${key}": ${result.error.message}`);
          }
          return null;
        }
        return result.data;
      }

      return parsed as T;
    } catch (error) {
      if (this.throwOnInvalid) {
        throw error;
      }
      return null;
    }
  }
}
