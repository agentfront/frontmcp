/**
 * StorageFederatedAuthSessionStore
 *
 * `FederatedAuthSessionStore` backed by a `@frontmcp/utils` `StorageAdapter`
 * (memory / Redis / SQLite). Parallel to {@link StorageTokenStore}: it stores
 * the serializable {@link FederatedAuthSessionRecord} as a JSON blob keyed by
 * session id, with a TTL derived from the session's `expiresAt`.
 *
 * Federated sessions are short-lived multi-provider OAuth flow state. Persisting
 * them (Redis/SQLite) lets an in-progress federated login survive a server
 * restart instead of being silently dropped.
 *
 * With an `encryptionKey` the record, which holds the upstream provider tokens
 * of the providers already linked, is sealed with AES-256-GCM under a key
 * derived for its session id. A plaintext record stored without one is still
 * read, and sealed at its next write.
 */

import { hkdfSha256, TypedStorage, type NamespacedStorage, type StorageAdapter } from '@frontmcp/utils';

import {
  fromSessionRecord,
  toSessionRecord,
  type FederatedAuthSession,
  type FederatedAuthSessionRecord,
  type FederatedAuthSessionStore,
} from './federated-auth.session';
import { decryptRecord, encryptRecord } from './orchestrated-token.crypto';

export interface StorageFederatedAuthSessionStoreOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'fed'
   */
  namespace?: string;

  /**
   * Key the stored records are encrypted with. Without one they are stored as
   * plain JSON (dev only).
   */
  encryptionKey?: Uint8Array;
}

/** A record sealed with the session's derived key. */
interface SealedFederatedAuthSession {
  sealed: string;
}

type StoredFederatedAuthSession = FederatedAuthSessionRecord | SealedFederatedAuthSession;

const HKDF_SALT = new TextEncoder().encode('frontmcp-federated-session');

export class StorageFederatedAuthSessionStore implements FederatedAuthSessionStore {
  private readonly storage: TypedStorage<StoredFederatedAuthSession>;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;
  private readonly encryptionKey?: Uint8Array;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageFederatedAuthSessionStoreOptions = {}) {
    this.namespace = options.namespace ?? 'fed';
    this.encryptionKey = options.encryptionKey;
    this.storageIsNamespaced = this.isNamespacedStorage(storage);

    const namespacedStorage = this.storageIsNamespaced
      ? (storage as NamespacedStorage).namespace(this.namespace)
      : storage;

    this.storage = new TypedStorage<StoredFederatedAuthSession>(namespacedStorage);
  }

  async store(session: FederatedAuthSession): Promise<void> {
    await this.put(session);
  }

  async update(session: FederatedAuthSession): Promise<void> {
    await this.put(session);
  }

  async get(id: string): Promise<FederatedAuthSession | null> {
    const stored = await this.storage.get(this.key(id));
    if (!stored) {
      return null;
    }

    // A record this key can't open may belong to another instance's key: leave it to its TTL.
    const record = this.open(id, stored);
    if (!record) {
      return null;
    }
    // Defensive expiry check (TTL backends expire on their own, but memory or a
    // SQLite read between sweeps may still surface an expired record).
    if (Date.now() > record.expiresAt) {
      await this.storage.delete(this.key(id));
      return null;
    }

    return fromSessionRecord(record);
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete(this.key(id));
  }

  private async put(session: FederatedAuthSession): Promise<void> {
    const record = toSessionRecord(session);
    const ttlSeconds = this.calculateTtl(record.expiresAt);
    const stored: StoredFederatedAuthSession = this.encryptionKey
      ? { sealed: encryptRecord(this.keyFor(session.id, this.encryptionKey), record) }
      : record;
    await this.storage.set(this.key(session.id), stored, ttlSeconds ? { ttlSeconds } : undefined);
  }

  /** The stored record, decrypted when sealed; null when it cannot be decrypted. */
  private open(id: string, stored: StoredFederatedAuthSession): FederatedAuthSessionRecord | null {
    if (!this.isSealed(stored)) {
      return stored;
    }
    if (!this.encryptionKey) {
      return null;
    }
    try {
      return decryptRecord<FederatedAuthSessionRecord>(this.keyFor(id, this.encryptionKey), stored.sealed);
    } catch {
      return null;
    }
  }

  private isSealed(stored: StoredFederatedAuthSession): stored is SealedFederatedAuthSession {
    return 'sealed' in stored;
  }

  private keyFor(id: string, encryptionKey: Uint8Array): Uint8Array {
    return hkdfSha256(encryptionKey, HKDF_SALT, new TextEncoder().encode(`federated-session:${id}`), 32);
  }

  private calculateTtl(expiresAtMs: number): number | undefined {
    const ttl = Math.ceil((expiresAtMs - Date.now()) / 1000);
    return ttl > 0 ? ttl : 1; // minimum 1s so the key still expires
  }

  private key(id: string): string {
    return this.storageIsNamespaced ? id : `${this.namespace}:${id}`;
  }

  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
