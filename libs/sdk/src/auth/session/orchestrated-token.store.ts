/**
 * Orchestrated Token Store
 *
 * Token store implementations for OrchestratedAuthorization.
 * These stores manage upstream provider tokens (access + refresh) indexed
 * by authorization ID and provider ID.
 *
 * Key differences from the low-level TokenStore in @frontmcp/auth:
 * - Uses composite keys (authorizationId + providerId)
 * - Handles access/refresh tokens as separate entries
 * - Returns decrypted strings directly (encryption is handled internally)
 */

import { TokenStore } from '../authorization/orchestrated.authorization';
import { encryptAesGcm, decryptAesGcm, randomBytes, hkdfSha256 } from '@frontmcp/utils';

/**
 * Internal token record structure
 */
interface ProviderTokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Options for InMemoryOrchestratedTokenStore
 */
export interface InMemoryOrchestratedTokenStoreOptions {
  /**
   * Encryption key for token storage. If not provided, tokens are stored in plain text.
   * For production, always provide an encryption key.
   */
  encryptionKey?: Uint8Array;

  /**
   * Default TTL in milliseconds for token records.
   * If not set and token has no expiresAt, records persist until explicitly deleted.
   * @default undefined (no automatic expiration)
   */
  defaultTtlMs?: number;

  /**
   * Interval for cleanup of expired tokens (ms).
   * @default 60000 (1 minute)
   */
  cleanupIntervalMs?: number;
}

/**
 * In-Memory Orchestrated Token Store
 *
 * Development/testing implementation for storing upstream provider tokens.
 * Supports optional encryption for tokens at rest.
 *
 * For production, use a persistent store backed by Redis or similar.
 *
 * @example
 * ```typescript
 * import { InMemoryOrchestratedTokenStore } from '@frontmcp/sdk';
 *
 * // Without encryption (dev only)
 * const store = new InMemoryOrchestratedTokenStore();
 *
 * // With encryption (recommended)
 * const key = randomBytes(32);
 * const store = new InMemoryOrchestratedTokenStore({ encryptionKey: key });
 *
 * // Store tokens
 * await store.storeTokens('auth-123', 'github', {
 *   accessToken: 'gho_xxxx',
 *   refreshToken: 'ghr_yyyy',
 *   expiresAt: Date.now() + 3600000,
 * });
 *
 * // Retrieve tokens
 * const accessToken = await store.getAccessToken('auth-123', 'github');
 * ```
 */
export class InMemoryOrchestratedTokenStore implements TokenStore {
  /** Token storage: Map<compositeKey, ProviderTokenRecord> */
  private readonly tokens = new Map<string, ProviderTokenRecord | string>();

  /** Encryption key for secure storage */
  private readonly encryptionKey?: Uint8Array;

  /** Derived keys cache for HKDF */
  private readonly derivedKeys = new Map<string, Uint8Array>();

  /** Cleanup interval timer */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Default TTL for records */
  private readonly defaultTtlMs?: number;

  constructor(options: InMemoryOrchestratedTokenStoreOptions = {}) {
    this.encryptionKey = options.encryptionKey;
    this.defaultTtlMs = options.defaultTtlMs;

    // Start cleanup timer
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, cleanupIntervalMs);

    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Build composite key from authorizationId and providerId
   */
  private buildKey(authorizationId: string, providerId: string): string {
    return `${authorizationId}:${providerId}`;
  }

  /**
   * Derive encryption key for a specific composite key using HKDF
   */
  private async deriveKeyForRecord(compositeKey: string): Promise<Uint8Array> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Check cache
    const cached = this.derivedKeys.get(compositeKey);
    if (cached) {
      return cached;
    }

    // Derive key using HKDF
    // hkdfSha256(ikm, salt, info, length)
    const info = new TextEncoder().encode(`orchestrated-token:${compositeKey}`);
    const salt = new TextEncoder().encode('frontmcp-token-store');
    const derivedKey = hkdfSha256(this.encryptionKey, salt, info, 32);
    this.derivedKeys.set(compositeKey, derivedKey);

    return derivedKey;
  }

  /**
   * Encrypt a token record
   */
  private async encryptRecord(compositeKey: string, record: ProviderTokenRecord): Promise<string> {
    const key = await this.deriveKeyForRecord(compositeKey);
    const plaintext = JSON.stringify(record);
    const iv = randomBytes(12);
    // Note: encryptAesGcm signature is (key, plaintext, iv)
    const { ciphertext, tag } = encryptAesGcm(key, new TextEncoder().encode(plaintext), iv);

    // Pack as base64url JSON
    return JSON.stringify({
      iv: Buffer.from(iv).toString('base64url'),
      tag: Buffer.from(tag).toString('base64url'),
      data: Buffer.from(ciphertext).toString('base64url'),
    });
  }

  /**
   * Decrypt a token record
   */
  private async decryptRecord(compositeKey: string, encrypted: string): Promise<ProviderTokenRecord> {
    const key = await this.deriveKeyForRecord(compositeKey);
    const { iv, tag, data } = JSON.parse(encrypted);

    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    const ciphertextBytes = Buffer.from(data, 'base64url');

    // Note: decryptAesGcm signature is (key, ciphertext, iv, tag)
    const plaintext = decryptAesGcm(key, ciphertextBytes, ivBytes, tagBytes);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  /**
   * Get raw record (handles encryption if enabled)
   */
  private async getRecord(authorizationId: string, providerId: string): Promise<ProviderTokenRecord | null> {
    const key = this.buildKey(authorizationId, providerId);
    const stored = this.tokens.get(key);

    if (!stored) {
      return null;
    }

    let record: ProviderTokenRecord;

    if (this.encryptionKey) {
      // Decrypt if encryption is enabled
      if (typeof stored !== 'string') {
        // Shouldn't happen, but handle gracefully
        return null;
      }
      try {
        record = await this.decryptRecord(key, stored);
      } catch {
        // Decryption failed, record is corrupted
        this.tokens.delete(key);
        return null;
      }
    } else {
      // No encryption
      record = stored as ProviderTokenRecord;
    }

    // Check expiration
    if (record.expiresAt && record.expiresAt < Date.now()) {
      this.tokens.delete(key);
      return null;
    }

    return record;
  }

  /**
   * Retrieve decrypted access token for a provider
   */
  async getAccessToken(authorizationId: string, providerId: string): Promise<string | null> {
    const record = await this.getRecord(authorizationId, providerId);
    return record?.accessToken ?? null;
  }

  /**
   * Retrieve decrypted refresh token for a provider
   */
  async getRefreshToken(authorizationId: string, providerId: string): Promise<string | null> {
    const record = await this.getRecord(authorizationId, providerId);
    return record?.refreshToken ?? null;
  }

  /**
   * Store tokens for a provider
   */
  async storeTokens(
    authorizationId: string,
    providerId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    },
  ): Promise<void> {
    const key = this.buildKey(authorizationId, providerId);
    const now = Date.now();

    const record: ProviderTokenRecord = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt ?? (this.defaultTtlMs ? now + this.defaultTtlMs : undefined),
      createdAt: now,
      updatedAt: now,
    };

    if (this.encryptionKey) {
      // Encrypt and store
      const encrypted = await this.encryptRecord(key, record);
      this.tokens.set(key, encrypted);
    } else {
      // Store plaintext (dev only)
      this.tokens.set(key, record);
    }
  }

  /**
   * Delete tokens for a provider
   */
  async deleteTokens(authorizationId: string, providerId: string): Promise<void> {
    const key = this.buildKey(authorizationId, providerId);
    this.tokens.delete(key);
    this.derivedKeys.delete(key);
  }

  /**
   * Check if tokens exist for a provider
   */
  async hasTokens(authorizationId: string, providerId: string): Promise<boolean> {
    const record = await this.getRecord(authorizationId, providerId);
    return record !== null;
  }

  /**
   * Delete all tokens for an authorization
   */
  async deleteAllForAuthorization(authorizationId: string): Promise<void> {
    const prefix = `${authorizationId}:`;
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        this.tokens.delete(key);
        this.derivedKeys.delete(key);
      }
    }
  }

  /**
   * Get all provider IDs for an authorization
   */
  async getProviderIds(authorizationId: string): Promise<string[]> {
    const prefix = `${authorizationId}:`;
    const providerIds: string[] = [];

    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        const providerId = key.slice(prefix.length);
        // Verify record is still valid
        const record = await this.getRecord(authorizationId, providerId);
        if (record) {
          providerIds.push(providerId);
        }
      }
    }

    return providerIds;
  }

  /**
   * Clean up expired tokens
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, stored] of this.tokens.entries()) {
      let record: ProviderTokenRecord | null = null;

      if (this.encryptionKey) {
        if (typeof stored === 'string') {
          try {
            record = await this.decryptRecord(key, stored);
          } catch {
            // Corrupted record, delete it
            keysToDelete.push(key);
            continue;
          }
        }
      } else {
        record = stored as ProviderTokenRecord;
      }

      if (record?.expiresAt && record.expiresAt < now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.tokens.delete(key);
      this.derivedKeys.delete(key);
    }
  }

  /**
   * Stop the cleanup timer
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Get total number of stored token records (for testing/monitoring)
   */
  get size(): number {
    return this.tokens.size;
  }

  /**
   * Clear all tokens (for testing)
   */
  clear(): void {
    this.tokens.clear();
    this.derivedKeys.clear();
  }

  /**
   * Migrate tokens from one authorization ID to another.
   * Used when tokens are stored with a pending ID during federated auth
   * and need to be accessible under the real authorization ID.
   *
   * @param fromAuthId - Source authorization ID (e.g., "pending:abc123")
   * @param toAuthId - Target authorization ID (e.g., "def456")
   */
  async migrateTokens(fromAuthId: string, toAuthId: string): Promise<void> {
    const prefix = `${fromAuthId}:`;
    const keysToMigrate: string[] = [];

    // Find all keys with the source authorization ID
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        keysToMigrate.push(key);
      }
    }

    // Migrate each token to the new authorization ID
    for (const oldKey of keysToMigrate) {
      const providerId = oldKey.slice(prefix.length);
      const newKey = this.buildKey(toAuthId, providerId);

      // Get the stored value (encrypted or not)
      const stored = this.tokens.get(oldKey);
      if (!stored) {
        continue;
      }

      // If encrypted, we need to decrypt with old key and re-encrypt with new key
      if (this.encryptionKey) {
        try {
          const record = await this.decryptRecord(oldKey, stored as string);
          const encrypted = await this.encryptRecord(newKey, record);
          this.tokens.set(newKey, encrypted);
        } catch {
          // Skip corrupted records
          continue;
        }
      } else {
        // Plain storage, just copy
        this.tokens.set(newKey, stored);
      }

      // Delete old entry
      this.tokens.delete(oldKey);
      this.derivedKeys.delete(oldKey);
    }
  }
}
