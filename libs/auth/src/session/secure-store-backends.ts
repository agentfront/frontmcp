/**
 * Built-in {@link SecureStoreBackend} implementations for the session-scoped
 * secure-secret store (#470).
 *
 * Both built-ins REUSE existing infra rather than re-implementing crypto:
 * - {@link EncryptedStorageSecureStoreBackend} wraps any `StorageAdapter`
 *   (memory / sqlite / redis — built via {@link createTokenStorageAdapter}) and
 *   encrypts every value at rest with the shared {@link VaultEncryption}
 *   primitive (AES-256-GCM, HKDF-SHA256). The in-memory backing is simply this
 *   backend over a `MemoryStorageAdapter`, so even the `'memory'` backing keeps
 *   secrets encrypted in the process heap (closing the in-memory side of #464).
 *
 * A backend keys solely on the `(namespace, key)` pair it is handed; the
 * accessor resolves `namespace` from the request scope before calling in.
 */

import { type SetOptions, type StorageAdapter } from '@frontmcp/utils';

import { noopAuthLogger, type AuthLogger } from '../common/auth-logger.interface';
import { type SecureStoreBackend } from './secure-store';
import { VaultEncryption, type EncryptedData } from './vault-encryption';

/** Default key prefix for all secure-store keys. */
const DEFAULT_KEY_PREFIX = 'mcp:secret:';

/** Internal: the encrypted record stored per secret. */
interface EncryptedSecretRecord {
  /** AES-256-GCM envelope of the plaintext value. */
  enc: EncryptedData;
}

/**
 * Options for {@link EncryptedStorageSecureStoreBackend}.
 */
export interface EncryptedStorageSecureStoreBackendOptions {
  /** Connected storage adapter backing the store (memory / sqlite / redis). */
  storage: StorageAdapter;
  /**
   * Master pepper for key derivation. Defense-in-depth: even with the stored
   * ciphertext an attacker still needs this pepper to derive the AES key. When
   * omitted, an empty pepper is used (the caller — LocalPrimaryAuth — passes the
   * server JWT/VAULT secret).
   */
  pepper?: string;
  /** Key prefix for all stored keys. @default 'mcp:secret:' */
  keyPrefix?: string;
  /** Scoped logger. @default noop */
  logger?: AuthLogger;
}

/**
 * `StorageAdapter`-backed secure-store backend with AES-256-GCM at-rest
 * encryption via {@link VaultEncryption}.
 *
 * Storage key layout (no PII; the namespace is an opaque hash/identity handed in
 * by the accessor):
 * - `secret:keys:<namespace>` → JSON array of key names (the key SET).
 * - `secret:data:<namespace>:<key>` → encrypted {@link EncryptedSecretRecord}.
 *
 * The per-namespace AES key is derived (and cached) from the namespace + pepper,
 * so a value written under one namespace cannot be decrypted under another.
 */
export class EncryptedStorageSecureStoreBackend implements SecureStoreBackend {
  private readonly storage: StorageAdapter;
  private readonly encryption: VaultEncryption;
  private readonly keyPrefix: string;
  private readonly logger: AuthLogger;
  /** Cache of derived AES keys, keyed by namespace. */
  private readonly keyCache = new Map<string, Promise<Uint8Array>>();

  constructor(options: EncryptedStorageSecureStoreBackendOptions) {
    this.storage = options.storage;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? noopAuthLogger;
    this.encryption = new VaultEncryption({
      pepper: options.pepper,
      hkdfInfo: 'frontmcp-secure-store-v1',
    });
  }

  // ============================================
  // Storage-key helpers
  // ============================================

  /** `secret:keys:<namespace>` → JSON array of key names. */
  private keysKey(namespace: string): string {
    return `${this.keyPrefix}keys:${namespace}`;
  }

  /** `secret:data:<namespace>:<key>` → encrypted record. */
  private dataKey(namespace: string, key: string): string {
    return `${this.keyPrefix}data:${namespace}:${key}`;
  }

  /**
   * Derive (and cache) the AES-256 key for a namespace. The namespace acts as
   * the HKDF salt material, so values are cryptographically isolated per scope.
   */
  private deriveKey(namespace: string): Promise<Uint8Array> {
    const cached = this.keyCache.get(namespace);
    if (cached) return cached;
    // Map the namespace onto VaultEncryption's claim slots: jti/vaultKey/sub all
    // carry the namespace, iat fixed at 0 so the derived key is stable for the
    // same (namespace, pepper) within and across processes.
    const promise = this.encryption.deriveKey({ jti: namespace, vaultKey: namespace, sub: namespace, iat: 0 });
    this.keyCache.set(namespace, promise);
    return promise;
  }

  private setOpts(ttlMs?: number): SetOptions | undefined {
    return ttlMs && ttlMs > 0 ? { ttlSeconds: Math.ceil(ttlMs / 1000) } : undefined;
  }

  // ============================================
  // SecureStoreBackend
  // ============================================

  async get(namespace: string, key: string): Promise<string | null> {
    const raw = await this.storage.get(this.dataKey(namespace, key));
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as EncryptedSecretRecord;
      const aesKey = await this.deriveKey(namespace);
      return await this.encryption.decrypt(record.enc, aesKey);
    } catch (err) {
      // Wrong key (different pepper) or corrupted/tampered data — fail closed.
      this.logger.warn(`SecureStore: failed to read secret "${key}": ${errMsg(err)}`);
      return null;
    }
  }

  async set(namespace: string, key: string, value: string, ttlMs?: number): Promise<void> {
    const aesKey = await this.deriveKey(namespace);
    const enc = await this.encryption.encrypt(value, aesKey);
    const record: EncryptedSecretRecord = { enc };
    const opts = this.setOpts(ttlMs);
    await this.storage.set(this.dataKey(namespace, key), JSON.stringify(record), opts);
    await this.addKeyToSet(namespace, key, opts);
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    const existed = await this.storage.delete(this.dataKey(namespace, key));
    const keys = await this.readKeySet(namespace);
    const next = keys.filter((k) => k !== key);
    if (next.length !== keys.length) {
      await this.writeKeySet(namespace, next);
    }
    return existed;
  }

  async list(namespace: string): Promise<string[]> {
    return this.readKeySet(namespace);
  }

  // ============================================
  // Key-set helpers (the namespace's key SET)
  // ============================================

  private async readKeySet(namespace: string): Promise<string[]> {
    const raw = await this.storage.get(this.keysKey(namespace));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  private async writeKeySet(namespace: string, keys: string[], opts?: SetOptions): Promise<void> {
    const unique = [...new Set(keys)];
    await this.storage.set(this.keysKey(namespace), JSON.stringify(unique), opts);
  }

  private async addKeyToSet(namespace: string, key: string, opts?: SetOptions): Promise<void> {
    const keys = await this.readKeySet(namespace);
    if (!keys.includes(key)) {
      keys.push(key);
      await this.writeKeySet(namespace, keys, opts);
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
