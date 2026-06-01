/**
 * StorageOrchestratedTokenStore
 *
 * Orchestrated-mode `TokenStore` backed by a `@frontmcp/utils` `StorageAdapter`
 * (memory / Redis / SQLite). Parallel to {@link InMemoryOrchestratedTokenStore}:
 * stores upstream provider access/refresh tokens keyed by
 * `authorizationId:providerId`, with the SAME AES-256-GCM + HKDF encryption at
 * rest (see `orchestrated-token.crypto.ts`).
 *
 * Persisting these (Redis/SQLite) means a user's connected upstream providers
 * survive a server restart instead of forcing re-authorization.
 *
 * Values are stored as raw strings on the adapter so we can choose, per record,
 * between an encrypted envelope (when `encryptionKey` is set) and plaintext JSON
 * (dev only) — matching the in-memory store's behavior exactly.
 */

import type { NamespacedStorage, StorageAdapter } from '@frontmcp/utils';

import type { TokenStore } from '../authorization/orchestrated.authorization';
import { EncryptionKeyNotConfiguredError } from '../errors/auth-internal.errors';
import {
  decryptRecord,
  deriveKeyForRecord,
  encryptRecord,
  type ProviderTokenRecord,
} from './orchestrated-token.crypto';

export interface StorageOrchestratedTokenStoreOptions {
  /**
   * Encryption key for token storage. If not provided, tokens are stored in
   * plain text (dev only). For production always provide a key.
   */
  encryptionKey?: Uint8Array;

  /**
   * Default TTL in milliseconds applied when a stored token has no `expiresAt`.
   * @default undefined (no automatic expiration)
   */
  defaultTtlMs?: number;

  /**
   * Namespace prefix for all keys.
   * @default 'otok'
   */
  namespace?: string;
}

export class StorageOrchestratedTokenStore implements TokenStore {
  private readonly storage: StorageAdapter | NamespacedStorage;
  private readonly encryptionKey?: Uint8Array;
  private readonly defaultTtlMs?: number;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;

  /** HKDF-derived subkey cache, keyed by composite key. */
  private readonly derivedKeys = new Map<string, Uint8Array>();

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageOrchestratedTokenStoreOptions = {}) {
    this.encryptionKey = options.encryptionKey;
    this.defaultTtlMs = options.defaultTtlMs;
    this.namespace = options.namespace ?? 'otok';
    this.storageIsNamespaced = this.isNamespacedStorage(storage);
    this.storage = this.storageIsNamespaced ? (storage as NamespacedStorage).namespace(this.namespace) : storage;
  }

  // ============================================
  // TokenStore interface
  // ============================================

  async getAccessToken(authorizationId: string, providerId: string): Promise<string | null> {
    const record = await this.getRecord(authorizationId, providerId);
    return record?.accessToken ?? null;
  }

  async getRefreshToken(authorizationId: string, providerId: string): Promise<string | null> {
    const record = await this.getRecord(authorizationId, providerId);
    return record?.refreshToken ?? null;
  }

  async storeTokens(
    authorizationId: string,
    providerId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void> {
    const compositeKey = this.compositeKey(authorizationId, providerId);
    const now = Date.now();
    const record: ProviderTokenRecord = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt ?? (this.defaultTtlMs ? now + this.defaultTtlMs : undefined),
      createdAt: now,
      updatedAt: now,
    };

    const value = this.encryptionKey ? encryptRecord(this.keyFor(compositeKey), record) : JSON.stringify(record);

    await this.storage.set(this.storageKey(compositeKey), value, this.ttlOptions(record.expiresAt));
  }

  async deleteTokens(authorizationId: string, providerId: string): Promise<void> {
    const compositeKey = this.compositeKey(authorizationId, providerId);
    await this.storage.delete(this.storageKey(compositeKey));
    this.derivedKeys.delete(compositeKey);
  }

  async hasTokens(authorizationId: string, providerId: string): Promise<boolean> {
    const record = await this.getRecord(authorizationId, providerId);
    return record !== null;
  }

  async getProviderIds(authorizationId: string): Promise<string[]> {
    const prefix = `${authorizationId}:`;
    const compositeKeys = await this.listCompositeKeys(`${prefix}*`);
    const providerIds: string[] = [];

    for (const compositeKey of compositeKeys) {
      if (!compositeKey.startsWith(prefix)) continue;
      const providerId = compositeKey.slice(prefix.length);
      // Verify the record is still valid (not expired / decryptable).
      const record = await this.getRecord(authorizationId, providerId);
      if (record) {
        providerIds.push(providerId);
      }
    }

    return providerIds;
  }

  async migrateTokens(fromAuthId: string, toAuthId: string): Promise<void> {
    const prefix = `${fromAuthId}:`;
    const compositeKeys = await this.listCompositeKeys(`${prefix}*`);

    for (const oldComposite of compositeKeys) {
      if (!oldComposite.startsWith(prefix)) continue;
      const providerId = oldComposite.slice(prefix.length);
      const newComposite = this.compositeKey(toAuthId, providerId);

      const stored = await this.storage.get(this.storageKey(oldComposite));
      if (stored === null) continue;

      if (this.encryptionKey) {
        // Decrypt with the old subkey, re-encrypt with the new subkey (the HKDF
        // info is bound to the composite key, so the key changes with the id).
        let record: ProviderTokenRecord;
        try {
          record = decryptRecord(this.keyFor(oldComposite), stored);
        } catch {
          continue; // skip corrupted records
        }
        const value = encryptRecord(this.keyFor(newComposite), record);
        await this.storage.set(this.storageKey(newComposite), value, this.ttlOptions(record.expiresAt));
      } else {
        // Plaintext: copy verbatim (preserve TTL where parseable).
        let expiresAt: number | undefined;
        try {
          expiresAt = (JSON.parse(stored) as ProviderTokenRecord).expiresAt;
        } catch {
          expiresAt = undefined;
        }
        await this.storage.set(this.storageKey(newComposite), stored, this.ttlOptions(expiresAt));
      }

      await this.storage.delete(this.storageKey(oldComposite));
      this.derivedKeys.delete(oldComposite);
    }
  }

  /**
   * Delete all tokens for an authorization id.
   */
  async deleteAllForAuthorization(authorizationId: string): Promise<void> {
    const prefix = `${authorizationId}:`;
    const compositeKeys = await this.listCompositeKeys(`${prefix}*`);
    for (const compositeKey of compositeKeys) {
      if (!compositeKey.startsWith(prefix)) continue;
      await this.storage.delete(this.storageKey(compositeKey));
      this.derivedKeys.delete(compositeKey);
    }
  }

  // ============================================
  // Internals
  // ============================================

  private async getRecord(authorizationId: string, providerId: string): Promise<ProviderTokenRecord | null> {
    const compositeKey = this.compositeKey(authorizationId, providerId);
    const stored = await this.storage.get(this.storageKey(compositeKey));
    if (stored === null) {
      return null;
    }

    let record: ProviderTokenRecord;
    if (this.encryptionKey) {
      try {
        record = decryptRecord(this.keyFor(compositeKey), stored);
      } catch {
        // Corrupted / undecryptable — drop it.
        await this.storage.delete(this.storageKey(compositeKey));
        return null;
      }
    } else {
      try {
        record = JSON.parse(stored) as ProviderTokenRecord;
      } catch {
        await this.storage.delete(this.storageKey(compositeKey));
        return null;
      }
    }

    // Defensive expiry check (TTL backends usually handle this themselves).
    if (record.expiresAt && record.expiresAt < Date.now()) {
      await this.storage.delete(this.storageKey(compositeKey));
      return null;
    }

    return record;
  }

  private keyFor(compositeKey: string): Uint8Array {
    if (!this.encryptionKey) {
      throw new EncryptionKeyNotConfiguredError();
    }
    return deriveKeyForRecord(this.encryptionKey, compositeKey, this.derivedKeys);
  }

  private compositeKey(authorizationId: string, providerId: string): string {
    return `${authorizationId}:${providerId}`;
  }

  private storageKey(compositeKey: string): string {
    return this.storageIsNamespaced ? compositeKey : `${this.namespace}:${compositeKey}`;
  }

  /**
   * List composite keys (authorizationId:providerId) matching a glob over the
   * composite-key space, stripping any non-namespaced prefix we added.
   */
  private async listCompositeKeys(compositeGlob: string): Promise<string[]> {
    const pattern = this.storageIsNamespaced ? compositeGlob : `${this.namespace}:${compositeGlob}`;
    const raw = await this.storage.keys(pattern);
    if (this.storageIsNamespaced) {
      return raw;
    }
    const stripPrefix = `${this.namespace}:`;
    return raw.map((k) => (k.startsWith(stripPrefix) ? k.slice(stripPrefix.length) : k));
  }

  private ttlOptions(expiresAtMs?: number): { ttlSeconds: number } | undefined {
    if (!expiresAtMs) {
      return undefined;
    }
    const ttl = Math.ceil((expiresAtMs - Date.now()) / 1000);
    return { ttlSeconds: ttl > 0 ? ttl : 1 };
  }

  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
