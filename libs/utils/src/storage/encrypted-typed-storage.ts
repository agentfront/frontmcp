/**
 * EncryptedTypedStorage
 *
 * A storage wrapper that provides transparent encryption/decryption
 * with key rotation support on top of StorageAdapter.
 *
 * Uses AES-256-GCM for encryption with automatic JSON serialization.
 *
 * @example
 * ```typescript
 * import { createStorage, EncryptedTypedStorage, randomBytes } from '@frontmcp/utils';
 *
 * interface Secret {
 *   apiKey: string;
 *   refreshToken: string;
 * }
 *
 * const storage = await createStorage({ type: 'memory' });
 * const keys = [
 *   { kid: 'key-2024', key: randomBytes(32) },
 *   { kid: 'key-2023', key: oldKey }, // For decrypting old data
 * ];
 *
 * const secrets = new EncryptedTypedStorage<Secret>(storage, { keys });
 *
 * // Data is encrypted before storage
 * await secrets.set('user:123', { apiKey: 'sk-...', refreshToken: 'rt-...' });
 *
 * // Data is decrypted on retrieval
 * const secret = await secrets.get('user:123');
 * ```
 */

import { encryptAesGcm, decryptAesGcm, randomBytes, base64urlEncode, base64urlDecode, hkdfSha256 } from '../crypto';
import type { StorageAdapter, NamespacedStorage, SetOptions } from './types';
import type {
  EncryptedTypedStorageOptions,
  EncryptedSetEntry,
  EncryptionKey,
  StoredEncryptedBlob,
  ClientKeyBinding,
} from './encrypted-typed-storage.types';
import { EncryptedStorageError } from './errors';

/** Text encoder for string to Uint8Array conversion */
const textEncoder = new TextEncoder();

/** Text decoder for Uint8Array to string conversion */
const textDecoder = new TextDecoder();

/**
 * EncryptedTypedStorage provides transparent encryption/decryption
 * on top of StorageAdapter.
 *
 * Features:
 * - AES-256-GCM encryption for all stored values
 * - Automatic JSON serialization/deserialization
 * - Key rotation support (multiple keys, first is active)
 * - Optional Zod schema validation after decryption
 * - Batch operations (mget/mset)
 */
export class EncryptedTypedStorage<T> {
  private readonly storage: StorageAdapter | NamespacedStorage;
  private activeKey: EncryptionKey;
  private readonly keyMap: Map<string, Uint8Array>;
  private readonly schema?: EncryptedTypedStorageOptions<T>['schema'];
  private readonly throwOnError: boolean;
  private readonly onKeyRotationNeeded?: EncryptedTypedStorageOptions<T>['onKeyRotationNeeded'];
  private readonly clientBinding?: ClientKeyBinding;

  constructor(storage: StorageAdapter | NamespacedStorage, options: EncryptedTypedStorageOptions<T>) {
    if (!options.keys || options.keys.length === 0) {
      throw new EncryptedStorageError('At least one encryption key is required');
    }

    // Validate all keys are 32 bytes
    for (const k of options.keys) {
      if (k.key.length !== 32) {
        throw new EncryptedStorageError(
          `Encryption key "${k.kid}" must be 32 bytes (AES-256), got ${k.key.length} bytes`,
        );
      }
    }

    this.storage = storage;
    this.activeKey = options.keys[0];
    this.keyMap = new Map(options.keys.map((k) => [k.kid, k.key]));
    this.schema = options.schema;
    this.throwOnError = options.throwOnError ?? false;
    this.onKeyRotationNeeded = options.onKeyRotationNeeded;
    this.clientBinding = options.clientBinding;
  }

  /**
   * Get a decrypted value by key.
   *
   * @param key - Storage key
   * @returns The decrypted value, or null if not found or decryption fails
   */
  async get(key: string): Promise<T | null> {
    const raw = await this.storage.get(key);
    if (raw === null) {
      return null;
    }

    return this.decryptAndParse(raw, key);
  }

  /**
   * Encrypt and store a value.
   *
   * @param key - Storage key
   * @param value - Value to encrypt and store
   * @param options - Optional TTL and conditional flags
   */
  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    const encrypted = this.encryptValue(value);
    const serialized = JSON.stringify(encrypted);
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
   * Get multiple decrypted values.
   *
   * @param keys - Array of storage keys
   * @returns Array of decrypted values (null for missing/invalid keys)
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
      return this.decryptAndParse(raw, keys[index]);
    });
  }

  /**
   * Encrypt and store multiple values.
   *
   * @param entries - Array of key-value-options entries
   */
  async mset(entries: EncryptedSetEntry<T>[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const rawEntries = entries.map((entry) => ({
      key: entry.key,
      value: JSON.stringify(this.encryptValue(entry.value)),
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
   * Re-encrypt a value with the active key.
   * Useful for key rotation - reads with old key, writes with new key.
   *
   * @param key - Storage key to re-encrypt
   * @param options - Optional TTL for the re-encrypted value
   * @returns true if value was re-encrypted, false if not found
   */
  async reencrypt(key: string, options?: SetOptions): Promise<boolean> {
    const value = await this.get(key);
    if (value === null) {
      return false;
    }

    await this.set(key, value, options);
    return true;
  }

  /**
   * Rotate the active encryption key.
   * New encryptions will use the new key; old keys remain for decryption.
   *
   * @param newKey - New encryption key to use for writes
   */
  rotateKey(newKey: EncryptionKey): void {
    if (newKey.key.length !== 32) {
      throw new EncryptedStorageError(`New encryption key must be 32 bytes (AES-256), got ${newKey.key.length} bytes`);
    }

    // Add to key map if not already present
    if (!this.keyMap.has(newKey.kid)) {
      this.keyMap.set(newKey.kid, newKey.key);
    }

    // Update active key reference
    this.activeKey = newKey;
  }

  /**
   * Get the active key ID.
   */
  get activeKeyId(): string {
    return this.activeKey.kid;
  }

  /**
   * Get all known key IDs.
   */
  get keyIds(): string[] {
    return Array.from(this.keyMap.keys());
  }

  /**
   * Get the underlying storage adapter.
   * Use with caution - operations bypass encryption.
   */
  get raw(): StorageAdapter | NamespacedStorage {
    return this.storage;
  }

  /**
   * Check if client-side key binding is enabled.
   * When true, encryption keys are derived from both server key and client secret.
   */
  get hasClientBinding(): boolean {
    return this.clientBinding !== undefined;
  }

  /**
   * Derive the actual encryption key.
   *
   * If clientBinding is configured, combines server key with client secret
   * using HKDF-SHA256 (RFC 5869) to produce the actual encryption key.
   * Otherwise, returns the server key as-is.
   *
   * This provides zero-knowledge encryption where:
   * - Server cannot decrypt without client secret (sessionId)
   * - Client cannot decrypt without server key
   * - Key derivation is deterministic (same inputs -> same derived key)
   *
   * @param serverKey - The server-side encryption key
   * @returns The key to use for actual encryption/decryption
   */
  private deriveKey(serverKey: Uint8Array): Uint8Array {
    if (!this.clientBinding) {
      return serverKey; // No binding - use server key directly
    }

    // Normalize client secret to Uint8Array
    const clientSecret =
      typeof this.clientBinding.secret === 'string'
        ? textEncoder.encode(this.clientBinding.secret)
        : this.clientBinding.secret;

    // Combine server key + client secret as IKM (Input Keying Material)
    const ikm = new Uint8Array(serverKey.length + clientSecret.length);
    ikm.set(serverKey, 0);
    ikm.set(clientSecret, serverKey.length);

    const salt = this.clientBinding.salt ?? new Uint8Array(0);
    const info = textEncoder.encode(this.clientBinding.info ?? 'frontmcp-client-bound-v1');

    // Derive 32-byte key using HKDF-SHA256
    return hkdfSha256(ikm, salt, info, 32);
  }

  /**
   * Encrypt a value using the active key.
   * If client binding is configured, uses derived key from server key + client secret.
   */
  private encryptValue(value: T): StoredEncryptedBlob {
    let jsonString: string;
    try {
      jsonString = JSON.stringify(value);
    } catch (error) {
      throw new EncryptedStorageError(`Failed to serialize value: ${(error as Error).message}`);
    }

    const plaintext = textEncoder.encode(jsonString);
    const iv = randomBytes(12);

    // Derive encryption key (applies client binding if configured)
    const encryptionKey = this.deriveKey(this.activeKey.key);

    const { ciphertext, tag } = encryptAesGcm(encryptionKey, plaintext, iv);

    return {
      alg: 'A256GCM',
      kid: this.activeKey.kid,
      iv: base64urlEncode(iv),
      tag: base64urlEncode(tag),
      data: base64urlEncode(ciphertext),
    };
  }

  /**
   * Decrypt and parse a stored value.
   */
  private decryptAndParse(raw: string, storageKey: string): T | null {
    let blob: StoredEncryptedBlob;
    try {
      blob = JSON.parse(raw);
    } catch (_error) {
      if (this.throwOnError) {
        throw new EncryptedStorageError(`Failed to parse stored blob for key "${storageKey}"`);
      }
      return null;
    }

    // Validate blob structure
    if (!this.isValidBlob(blob)) {
      if (this.throwOnError) {
        throw new EncryptedStorageError(`Invalid encrypted blob structure for key "${storageKey}"`);
      }
      return null;
    }

    // Find the server key used for encryption
    const serverKey = this.keyMap.get(blob.kid);
    if (!serverKey) {
      if (this.throwOnError) {
        throw new EncryptedStorageError(
          `Unknown encryption key "${blob.kid}" for key "${storageKey}". ` +
            `Known keys: ${Array.from(this.keyMap.keys()).join(', ')}`,
        );
      }
      return null;
    }

    // Derive decryption key (applies client binding if configured)
    const decryptionKey = this.deriveKey(serverKey);

    // Decrypt
    let decrypted: T;
    try {
      const iv = base64urlDecode(blob.iv);
      const tag = base64urlDecode(blob.tag);
      const ciphertext = base64urlDecode(blob.data);

      const plaintext = decryptAesGcm(decryptionKey, ciphertext, iv, tag);
      decrypted = JSON.parse(textDecoder.decode(plaintext));
    } catch (error) {
      if (this.throwOnError) {
        throw new EncryptedStorageError(`Decryption failed for key "${storageKey}": ${(error as Error).message}`);
      }
      return null;
    }

    // Validate with schema if provided
    if (this.schema) {
      const result = this.schema.safeParse(decrypted);
      if (!result.success) {
        if (this.throwOnError) {
          throw new EncryptedStorageError(`Schema validation failed for key "${storageKey}": ${result.error.message}`);
        }
        return null;
      }
      decrypted = result.data;
    }

    // Notify if value was encrypted with non-active key
    if (blob.kid !== this.activeKey.kid && this.onKeyRotationNeeded) {
      this.onKeyRotationNeeded(storageKey, blob.kid, this.activeKey.kid);
    }

    return decrypted;
  }

  /**
   * Validate blob structure.
   */
  private isValidBlob(blob: unknown): blob is StoredEncryptedBlob {
    return (
      typeof blob === 'object' &&
      blob !== null &&
      'alg' in blob &&
      'kid' in blob &&
      'iv' in blob &&
      'tag' in blob &&
      'data' in blob &&
      (blob as StoredEncryptedBlob).alg === 'A256GCM' &&
      typeof (blob as StoredEncryptedBlob).kid === 'string' &&
      typeof (blob as StoredEncryptedBlob).iv === 'string' &&
      typeof (blob as StoredEncryptedBlob).tag === 'string' &&
      typeof (blob as StoredEncryptedBlob).data === 'string'
    );
  }
}
