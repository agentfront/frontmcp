/**
 * StorageAuthorizationStore
 *
 * `AuthorizationStore` backed by a `@frontmcp/utils` `StorageAdapter`
 * (memory / Redis / SQLite). This is the adapter-backed counterpart to
 * {@link InMemoryAuthorizationStore}, giving local-mode auth persistent
 * authorization codes, pending authorizations, and refresh tokens.
 *
 * Records are stored as JSON blobs keyed by type, with TTL derived from each
 * record's `expiresAt`. The pure record-builder helpers (`createCodeRecord`,
 * etc.) are inherited from the shared `authorization.store` functions, so the
 * minted records are byte-for-byte identical to the in-memory store's.
 */

import { TypedStorage, type NamespacedStorage, type StorageAdapter } from '@frontmcp/utils';

import {
  buildCodeRecord,
  buildPendingRecord,
  buildRefreshTokenRecord,
  generateAuthorizationCode,
  generateRefreshTokenValue,
  type AuthorizationCodeRecord,
  type AuthorizationStore,
  type CreateCodeRecordParams,
  type CreatePendingRecordParams,
  type CreateRefreshTokenRecordParams,
  type PendingAuthorizationRecord,
  type RefreshTokenRecord,
} from './authorization.store';

export interface StorageAuthorizationStoreOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'oauth'
   */
  namespace?: string;
}

type RecordType = 'code' | 'pending' | 'refresh';

export class StorageAuthorizationStore implements AuthorizationStore {
  private readonly codeStore: TypedStorage<AuthorizationCodeRecord>;
  private readonly pendingStore: TypedStorage<PendingAuthorizationRecord>;
  private readonly refreshStore: TypedStorage<RefreshTokenRecord>;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageAuthorizationStoreOptions = {}) {
    this.namespace = options.namespace ?? 'oauth';
    this.storageIsNamespaced = this.isNamespacedStorage(storage);

    const base = this.storageIsNamespaced ? (storage as NamespacedStorage).namespace(this.namespace) : storage;

    this.codeStore = new TypedStorage<AuthorizationCodeRecord>(base);
    this.pendingStore = new TypedStorage<PendingAuthorizationRecord>(base);
    this.refreshStore = new TypedStorage<RefreshTokenRecord>(base);
  }

  // ============================================
  // Record builders (pure; shared with in-memory store)
  // ============================================

  generateCode(): string {
    return generateAuthorizationCode();
  }

  generateRefreshToken(): string {
    return generateRefreshTokenValue();
  }

  createCodeRecord(params: CreateCodeRecordParams): AuthorizationCodeRecord {
    return buildCodeRecord(params);
  }

  createPendingRecord(params: CreatePendingRecordParams): PendingAuthorizationRecord {
    return buildPendingRecord(params);
  }

  createRefreshTokenRecord(params: CreateRefreshTokenRecordParams): RefreshTokenRecord {
    return buildRefreshTokenRecord(params);
  }

  // ============================================
  // Authorization code operations
  // ============================================

  async storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    await this.codeStore.set(this.key('code', record.code), record, this.ttl(record.expiresAt));
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null> {
    const record = await this.codeStore.get(this.key('code', code));
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      await this.codeStore.delete(this.key('code', code));
      return null;
    }
    return record;
  }

  async markCodeUsed(code: string): Promise<void> {
    const record = await this.getAuthorizationCode(code);
    if (record) {
      record.used = true;
      await this.codeStore.set(this.key('code', code), record, this.ttl(record.expiresAt));
    }
  }

  async deleteAuthorizationCode(code: string): Promise<void> {
    await this.codeStore.delete(this.key('code', code));
  }

  // ============================================
  // Pending authorization operations
  // ============================================

  async storePendingAuthorization(record: PendingAuthorizationRecord): Promise<void> {
    await this.pendingStore.set(this.key('pending', record.id), record, this.ttl(record.expiresAt));
  }

  async getPendingAuthorization(id: string): Promise<PendingAuthorizationRecord | null> {
    const record = await this.pendingStore.get(this.key('pending', id));
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      await this.pendingStore.delete(this.key('pending', id));
      return null;
    }
    return record;
  }

  async deletePendingAuthorization(id: string): Promise<void> {
    await this.pendingStore.delete(this.key('pending', id));
  }

  // ============================================
  // Refresh token operations
  // ============================================

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.refreshStore.set(this.key('refresh', record.token), record, this.ttl(record.expiresAt));
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const record = await this.refreshStore.get(this.key('refresh', token));
    if (!record) return null;
    if (Date.now() > record.expiresAt || record.revoked) {
      return null;
    }
    return record;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const record = await this.refreshStore.get(this.key('refresh', token));
    if (record) {
      record.revoked = true;
      await this.refreshStore.set(this.key('refresh', token), record, this.ttl(record.expiresAt));
    }
  }

  async rotateRefreshToken(oldToken: string, newRecord: RefreshTokenRecord): Promise<void> {
    await this.revokeRefreshToken(oldToken);
    newRecord.previousToken = oldToken;
    await this.storeRefreshToken(newRecord);
  }

  // ============================================
  // Utility
  // ============================================

  async cleanup(): Promise<void> {
    // TTL-capable backends (Redis, SQLite, memory adapter) expire keys on their
    // own; per-record expiry is also enforced lazily on read. Nothing to do.
  }

  // ============================================
  // Internals
  // ============================================

  private ttl(expiresAtMs: number): { ttlSeconds: number } | undefined {
    const ttl = Math.ceil((expiresAtMs - Date.now()) / 1000);
    return { ttlSeconds: ttl > 0 ? ttl : 1 };
  }

  private key(type: RecordType, id: string): string {
    const composite = `${type}:${id}`;
    return this.storageIsNamespaced ? composite : `${this.namespace}:${composite}`;
  }

  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
