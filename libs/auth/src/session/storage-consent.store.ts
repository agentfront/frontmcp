/**
 * StorageConsentStore
 *
 * {@link ConsentStore} backed by a `@frontmcp/utils` `StorageAdapter`
 * (memory / Redis / SQLite). Parallel to {@link StorageFederatedAuthSessionStore}:
 * it stores the {@link RememberedConsentRecord} as a JSON blob keyed by
 * `consent:{userSub}:{clientId}`.
 *
 * Unlike federated sessions (short-lived flow state), a remembered consent
 * selection is intentionally long-lived — it survives restarts so a returning
 * user keeps their prior tool selection — so no TTL is applied here.
 */

import { TypedStorage, type NamespacedStorage, type StorageAdapter } from '@frontmcp/utils';

import { consentRecordKey, type ConsentStore, type RememberedConsentRecord } from './consent.store';

export interface StorageConsentStoreOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'remembered-consent'
   */
  namespace?: string;
}

export class StorageConsentStore implements ConsentStore {
  private readonly storage: TypedStorage<RememberedConsentRecord>;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageConsentStoreOptions = {}) {
    this.namespace = options.namespace ?? 'remembered-consent';
    this.storageIsNamespaced = this.isNamespacedStorage(storage);

    const namespacedStorage = this.storageIsNamespaced
      ? (storage as NamespacedStorage).namespace(this.namespace)
      : storage;

    this.storage = new TypedStorage<RememberedConsentRecord>(namespacedStorage);
  }

  async get(userSub: string, clientId: string): Promise<RememberedConsentRecord | null> {
    return this.storage.get(this.key(userSub, clientId));
  }

  async set(record: RememberedConsentRecord): Promise<void> {
    await this.storage.set(this.key(record.userSub, record.clientId), record);
  }

  async delete(userSub: string, clientId: string): Promise<void> {
    await this.storage.delete(this.key(userSub, clientId));
  }

  private key(userSub: string, clientId: string): string {
    const base = consentRecordKey(userSub, clientId);
    return this.storageIsNamespaced ? base : `${this.namespace}:${base}`;
  }

  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
