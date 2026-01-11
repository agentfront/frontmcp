/**
 * StorageTokenStore
 *
 * TokenStore implementation backed by @frontmcp/utils/storage adapters.
 * Supports Memory, Redis, Vercel KV, and Upstash backends.
 *
 * @example
 * ```typescript
 * import { createStorage } from '@frontmcp/utils/storage';
 * import { StorageTokenStore } from '@frontmcp/auth';
 *
 * const storage = await createStorage({ type: 'auto' });
 * const tokenStore = new StorageTokenStore(storage);
 *
 * const id = tokenStore.allocId();
 * await tokenStore.put(id, encryptedBlob);
 * const record = await tokenStore.get(id);
 * ```
 */

import { randomUUID } from '@frontmcp/utils';
import type { StorageAdapter, NamespacedStorage } from '@frontmcp/utils';
import type { TokenStore, SecretRecord } from '../token.store';
import type { EncBlob } from '../token.vault';
import { TypedStorage } from './typed-storage';

/**
 * Options for StorageTokenStore
 */
export interface StorageTokenStoreOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'tok'
   */
  namespace?: string;

  /**
   * Default TTL in seconds when not derived from blob.exp.
   * If not set and blob.exp is not present, no TTL is applied.
   */
  defaultTtlSeconds?: number;
}

/**
 * TokenStore implementation using StorageAdapter.
 *
 * Uses the blob's `exp` field (epoch seconds) to calculate TTL for automatic
 * expiration in the underlying storage backend.
 */
export class StorageTokenStore implements TokenStore {
  private readonly storage: TypedStorage<SecretRecord>;
  private readonly namespace: string;
  private readonly defaultTtlSeconds?: number;
  /** Track if original storage was namespaced to avoid double-prefixing */
  private readonly storageIsNamespaced: boolean;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageTokenStoreOptions = {}) {
    this.namespace = options.namespace ?? 'tok';
    this.defaultTtlSeconds = options.defaultTtlSeconds;

    // Track whether original storage supports namespacing
    this.storageIsNamespaced = 'namespace' in storage && typeof storage.namespace === 'function';

    // Create a namespaced view if we have a NamespacedStorage
    const namespacedStorage = this.storageIsNamespaced
      ? (storage as NamespacedStorage).namespace(this.namespace)
      : storage;

    this.storage = new TypedStorage<SecretRecord>(namespacedStorage);
  }

  /**
   * Allocate a new unique ID for a token record.
   */
  allocId(): string {
    return randomUUID();
  }

  /**
   * Store an encrypted token blob.
   *
   * TTL is calculated from blob.exp (epoch seconds) if present.
   * Falls back to defaultTtlSeconds if configured.
   *
   * @param id - Token record ID
   * @param blob - Encrypted token blob
   */
  async put(id: string, blob: EncBlob): Promise<void> {
    const record: SecretRecord = {
      id,
      blob,
      updatedAt: Date.now(),
    };

    const ttlSeconds = this.calculateTtl(blob.exp);
    await this.storage.set(this.key(id), record, ttlSeconds ? { ttlSeconds } : undefined);
  }

  /**
   * Retrieve a token record by ID.
   *
   * @param id - Token record ID
   * @returns The secret record, or undefined if not found
   */
  async get(id: string): Promise<SecretRecord | undefined> {
    const record = await this.storage.get(this.key(id));
    return record ?? undefined;
  }

  /**
   * Delete a token record.
   *
   * @param id - Token record ID
   */
  async del(id: string): Promise<void> {
    await this.storage.delete(this.key(id));
  }

  /**
   * Calculate TTL in seconds from expiration timestamp.
   *
   * @param exp - Expiration timestamp in epoch seconds
   * @returns TTL in seconds, or undefined if no TTL should be applied
   */
  private calculateTtl(exp?: number): number | undefined {
    if (exp) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ttl = exp - nowSeconds;
      // Only return positive TTL
      return ttl > 0 ? ttl : 1; // Minimum 1 second to ensure key expires
    }
    return this.defaultTtlSeconds;
  }

  /**
   * Build the storage key for a token ID.
   * For namespaced storage, the namespace is handled by the storage layer.
   * For non-namespaced storage, includes the namespace prefix in the key.
   */
  private key(id: string): string {
    return this.storageIsNamespaced ? id : `${this.namespace}:${id}`;
  }
}
