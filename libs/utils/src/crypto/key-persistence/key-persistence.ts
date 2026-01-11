/**
 * KeyPersistence - Unified key management with storage abstraction.
 *
 * Provides a high-level API for storing and retrieving cryptographic keys
 * with any storage backend (memory, filesystem, Redis, etc.).
 *
 * @module @frontmcp/utils/key-persistence
 */

import type { StorageAdapter } from '../../storage/types';
import { randomBytes, base64urlEncode } from '../index';
import { validateKeyData, isSecretKeyData, isAsymmetricKeyData } from './schemas';
import type { AnyKeyData, SecretKeyData, AsymmetricKeyData, KeyPersistenceOptions, CreateSecretOptions } from './types';

/**
 * KeyPersistence provides a unified API for storing and retrieving
 * cryptographic keys with any storage backend.
 *
 * Features:
 * - Type-safe key storage with Zod validation
 * - In-memory caching for fast reads
 * - Support for symmetric secrets and asymmetric key pairs
 * - Works with any StorageAdapter (Memory, FileSystem, Redis, etc.)
 *
 * @example
 * ```typescript
 * import { KeyPersistence, MemoryStorageAdapter } from '@frontmcp/utils';
 *
 * const storage = new MemoryStorageAdapter();
 * await storage.connect();
 *
 * const keys = new KeyPersistence({ storage });
 *
 * // Get or create a secret
 * const secret = await keys.getOrCreateSecret('encryption-key');
 * console.log(secret.secret); // base64url string
 *
 * // Store a custom key
 * await keys.set({
 *   type: 'secret',
 *   kid: 'my-key',
 *   secret: 'abc...',
 *   bytes: 32,
 *   createdAt: Date.now(),
 *   version: 1,
 * });
 *
 * // List all keys
 * const kids = await keys.list();
 * ```
 */
export class KeyPersistence {
  private readonly storage: StorageAdapter;
  private readonly cache = new Map<string, AnyKeyData>();
  private readonly enableCache: boolean;
  private readonly throwOnInvalid: boolean;

  constructor(options: KeyPersistenceOptions) {
    this.storage = options.storage;
    this.enableCache = options.enableCache ?? true;
    this.throwOnInvalid = options.throwOnInvalid ?? false;
  }

  /**
   * Get a key by ID.
   *
   * @param kid - Key identifier
   * @returns Key data or null if not found
   */
  async get<T extends AnyKeyData = AnyKeyData>(kid: string): Promise<T | null> {
    // Check cache first
    if (this.enableCache) {
      const cached = this.cache.get(kid);
      if (cached) return cached as T;
    }

    const raw = await this.storage.get(kid);
    if (!raw) return null;

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (this.throwOnInvalid) {
        throw new Error(`Invalid JSON for key "${kid}"`);
      }
      return null;
    }

    // Validate key data
    const validation = validateKeyData(parsed);
    if (!validation.valid) {
      if (this.throwOnInvalid) {
        throw new Error(`Invalid key data for "${kid}": ${validation.error}`);
      }
      return null;
    }

    const key = validation.data!;

    // Update cache
    if (this.enableCache) {
      this.cache.set(kid, key);
    }

    return key as T;
  }

  /**
   * Get a secret key by ID.
   *
   * @param kid - Key identifier
   * @returns Secret key data or null if not found or wrong type
   */
  async getSecret(kid: string): Promise<SecretKeyData | null> {
    const key = await this.get(kid);
    if (!key || !isSecretKeyData(key)) return null;
    return key;
  }

  /**
   * Get an asymmetric key by ID.
   *
   * @param kid - Key identifier
   * @returns Asymmetric key data or null if not found or wrong type
   */
  async getAsymmetric(kid: string): Promise<AsymmetricKeyData | null> {
    const key = await this.get(kid);
    if (!key || !isAsymmetricKeyData(key)) return null;
    return key;
  }

  /**
   * Store a key.
   *
   * @param key - Key data to store
   */
  async set(key: AnyKeyData): Promise<void> {
    // Validate key data
    const validation = validateKeyData(key);
    if (!validation.valid) {
      throw new Error(`Invalid key data: ${validation.error}`);
    }

    await this.storage.set(key.kid, JSON.stringify(key, null, 2));

    // Update cache
    if (this.enableCache) {
      this.cache.set(key.kid, key);
    }
  }

  /**
   * Delete a key.
   *
   * @param kid - Key identifier
   * @returns true if key existed and was deleted
   */
  async delete(kid: string): Promise<boolean> {
    // Remove from cache
    this.cache.delete(kid);

    return this.storage.delete(kid);
  }

  /**
   * Check if a key exists.
   *
   * @param kid - Key identifier
   * @returns true if key exists
   */
  async has(kid: string): Promise<boolean> {
    if (this.enableCache && this.cache.has(kid)) {
      return true;
    }
    return this.storage.exists(kid);
  }

  /**
   * List all key IDs.
   *
   * @returns Array of key identifiers
   */
  async list(): Promise<string[]> {
    return this.storage.keys();
  }

  /**
   * Get or create a secret key.
   *
   * If a key with the given ID exists and is a valid secret key,
   * it is returned. Otherwise, a new secret key is generated.
   *
   * @param kid - Key identifier
   * @param options - Options for key creation
   * @returns Secret key data
   *
   * @example
   * ```typescript
   * const secret = await keys.getOrCreateSecret('encryption-key');
   * const bytes = base64urlDecode(secret.secret);
   * ```
   */
  async getOrCreateSecret(kid: string, options?: CreateSecretOptions): Promise<SecretKeyData> {
    const existing = await this.getSecret(kid);
    if (existing) {
      return existing;
    }

    const bytes = options?.bytes ?? 32;
    const secret: SecretKeyData = {
      type: 'secret',
      kid,
      secret: base64urlEncode(randomBytes(bytes)),
      bytes,
      createdAt: Date.now(),
      version: 1,
    };

    await this.set(secret);
    return secret;
  }

  /**
   * Clear the in-memory cache.
   *
   * Useful when you want to force a reload from storage.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for a specific key.
   *
   * @param kid - Key identifier
   */
  clearCacheFor(kid: string): void {
    this.cache.delete(kid);
  }

  /**
   * Check if a key is in the cache.
   *
   * @param kid - Key identifier
   * @returns true if key is cached
   */
  isCached(kid: string): boolean {
    return this.cache.has(kid);
  }

  /**
   * Get the underlying storage adapter.
   *
   * Use with caution - direct storage access bypasses validation.
   */
  getAdapter(): StorageAdapter {
    return this.storage;
  }
}
