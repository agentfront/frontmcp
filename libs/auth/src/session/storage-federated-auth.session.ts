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
 */

import { TypedStorage, type NamespacedStorage, type StorageAdapter } from '@frontmcp/utils';

import {
  fromSessionRecord,
  toSessionRecord,
  type FederatedAuthSession,
  type FederatedAuthSessionRecord,
  type FederatedAuthSessionStore,
} from './federated-auth.session';

export interface StorageFederatedAuthSessionStoreOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'fed'
   */
  namespace?: string;
}

export class StorageFederatedAuthSessionStore implements FederatedAuthSessionStore {
  private readonly storage: TypedStorage<FederatedAuthSessionRecord>;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageFederatedAuthSessionStoreOptions = {}) {
    this.namespace = options.namespace ?? 'fed';
    this.storageIsNamespaced = this.isNamespacedStorage(storage);

    const namespacedStorage = this.storageIsNamespaced
      ? (storage as NamespacedStorage).namespace(this.namespace)
      : storage;

    this.storage = new TypedStorage<FederatedAuthSessionRecord>(namespacedStorage);
  }

  async store(session: FederatedAuthSession): Promise<void> {
    await this.put(session);
  }

  async update(session: FederatedAuthSession): Promise<void> {
    await this.put(session);
  }

  async get(id: string): Promise<FederatedAuthSession | null> {
    const record = await this.storage.get(this.key(id));
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
    await this.storage.set(this.key(session.id), record, ttlSeconds ? { ttlSeconds } : undefined);
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
