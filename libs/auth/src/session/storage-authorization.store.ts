/**
 * StorageAuthorizationStore
 *
 * `AuthorizationStore` backed by a `@frontmcp/utils` `StorageAdapter`
 * (memory / Redis / SQLite). This is the adapter-backed counterpart to
 * {@link InMemoryAuthorizationStore}, giving local-mode auth persistent
 * authorization codes, pending authorizations, and refresh tokens.
 *
 * Records are stored as JSON blobs with TTL derived from each record's
 * `expiresAt`. Each row is named by its type and a keyed hash of the value a
 * client presents (`oauth:refresh:<HMAC-SHA256(k, token)>`), never by the value
 * itself; see `authorization-row-names.ts`. A row named by the value, as up to
 * 1.13, is still read, and moves under its hashed name when it is used. The pure
 * record-builder helpers (`createCodeRecord`, etc.) are inherited from the shared
 * `authorization.store` functions, so the minted records are byte-for-byte
 * identical to the in-memory store's.
 */

import {
  escapeGlob,
  StorageNotSupportedError,
  TypedStorage,
  type NamespacedStorage,
  type StorageAdapter,
} from '@frontmcp/utils';

import { AuthorizationRowNames, type AuthorizationKeyHashSecret } from './authorization-row-names';
import {
  authorizationCodeRedeemedError,
  buildCodeRecord,
  buildPendingRecord,
  buildRefreshTokenRecord,
  generateAuthorizationCode,
  generateRefreshTokenValue,
  isRedeemableCode,
  isRotatableRefreshToken,
  refreshTokenRedeemedError,
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

  /**
   * The secret the row names are derived from: each code, pending authorization and refresh token row is named
   * `<type>:<HMAC-SHA256(k, value)>`, with `k` derived from this secret by HKDF-SHA256. Keep it the same across
   * restarts and on every instance that shares the storage: rows named under another secret are not found. Local
   * auth passes `tokenStorageKeyHashSecret()`: the SQLite `encryption.secret`, else `JWT_SECRET`. Without one the
   * names are hashed under a fixed key: they hold no value, and stay the same across restarts.
   */
  keyHashSecret?: AuthorizationKeyHashSecret;
}

type RecordType = 'code' | 'pending' | 'refresh';

/** A record and the key it was read from: its hashed name, or the name up to 1.13 (`legacy`). */
interface FoundRecord<T> {
  key: string;
  record: T;
  legacy: boolean;
}

/** The value each record type is named after. */
const NAMED_BY: Record<RecordType, 'code' | 'id' | 'token'> = { code: 'code', pending: 'id', refresh: 'token' };

export class StorageAuthorizationStore implements AuthorizationStore {
  private readonly codeStore: TypedStorage<AuthorizationCodeRecord>;
  private readonly pendingStore: TypedStorage<PendingAuthorizationRecord>;
  private readonly refreshStore: TypedStorage<RefreshTokenRecord>;
  private readonly namespace: string;
  private readonly storageIsNamespaced: boolean;
  private readonly base: StorageAdapter | NamespacedStorage;
  private readonly rowNames: AuthorizationRowNames;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageAuthorizationStoreOptions = {}) {
    this.namespace = options.namespace ?? 'oauth';
    this.storageIsNamespaced = this.isNamespacedStorage(storage);
    this.rowNames = new AuthorizationRowNames(options.keyHashSecret);

    const base = this.storageIsNamespaced ? (storage as NamespacedStorage).namespace(this.namespace) : storage;
    this.base = base;

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
    return (await this.findUnexpired(this.codeStore, 'code', code))?.record ?? null;
  }

  async markCodeUsed(code: string, issuedRefreshToken?: string): Promise<void> {
    if (issuedRefreshToken === undefined) {
      const claimed = await this.claim(this.codeStore, 'code', code, isRedeemableCode, (record) => ({
        ...record,
        used: true,
      }));
      if (!claimed) throw authorizationCodeRedeemedError();
      return;
    }
    const found = await this.findUnexpired(this.codeStore, 'code', code);
    if (found) {
      const record = { ...found.record, used: true };
      if (issuedRefreshToken) record.issuedRefreshToken = issuedRefreshToken;
      await this.replace(this.codeStore, 'code', code, found, record);
    }
  }

  async deleteAuthorizationCode(code: string): Promise<void> {
    await this.deleteBoth(this.codeStore, 'code', code);
  }

  // ============================================
  // Pending authorization operations
  // ============================================

  async storePendingAuthorization(record: PendingAuthorizationRecord): Promise<void> {
    // A pending authorization started before 1.14 keeps a row under its old name until it is deleted or expires
    // (10 minutes): reads find the newer row under the hashed name first.
    await this.pendingStore.set(this.key('pending', record.id), record, this.ttl(record.expiresAt));
  }

  async getPendingAuthorization(id: string): Promise<PendingAuthorizationRecord | null> {
    return (await this.findUnexpired(this.pendingStore, 'pending', id))?.record ?? null;
  }

  async deletePendingAuthorization(id: string): Promise<void> {
    await this.deleteBoth(this.pendingStore, 'pending', id);
  }

  // ============================================
  // Refresh token operations
  // ============================================

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.refreshStore.set(this.key('refresh', record.token), record, this.ttl(record.expiresAt));
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const found = await this.find(this.refreshStore, 'refresh', token);
    if (!found) return null;
    if (Date.now() > found.record.expiresAt || found.record.revoked) {
      return null;
    }
    return found.record;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const found = await this.find(this.refreshStore, 'refresh', token);
    if (found) {
      await this.replace(this.refreshStore, 'refresh', token, found, { ...found.record, revoked: true });
    }
  }

  async rotateRefreshToken(oldToken: string, newRecord: RefreshTokenRecord): Promise<void> {
    const claimed = await this.claim(this.refreshStore, 'refresh', oldToken, isRotatableRefreshToken, (record) => ({
      ...record,
      revoked: true,
    }));
    if (!claimed) throw refreshTokenRedeemedError();
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

  /**
   * Move every row still named by its value (as up to 1.13) under its hashed name, at once rather than when each is
   * used. A row is moved by the request that deletes it in one compare-and-delete step, so this can run beside the
   * servers; run it once every instance runs 1.14, with the `keyHashSecret` the servers use, or the moved rows are not
   * found. Rows already hashed, and rows that are not this store's, are left alone.
   *
   * @returns how many rows were moved (expired ones are deleted, and not counted).
   */
  async moveLegacyRows(): Promise<number> {
    let moved = 0;
    for (const type of Object.keys(NAMED_BY) as RecordType[]) {
      for (const key of await this.base.keys(`${escapeGlob(this.prefix(type))}*`)) {
        if (await this.moveLegacyRow(type, key)) moved += 1;
      }
    }
    return moved;
  }

  // ============================================
  // Internals
  // ============================================

  /** The record under the hashed name of `id`, else under its name up to 1.13; null when neither holds one. */
  private async find<T>(store: TypedStorage<T>, type: RecordType, id: string): Promise<FoundRecord<T> | null> {
    const key = this.key(type, id);
    const record = await store.get(key);
    if (record !== null) return { key, record, legacy: false };
    // A row under its hashed name is the only one read, so a row under the old name is never claimed after it.
    const legacyKey = this.legacyKey(type, id);
    const legacy = await store.get(legacyKey);
    return legacy === null ? null : { key: legacyKey, record: legacy, legacy: true };
  }

  /** {@link find}, deleting an expired record and answering null for it. */
  private async findUnexpired<T extends { expiresAt: number }>(
    store: TypedStorage<T>,
    type: RecordType,
    id: string,
  ): Promise<FoundRecord<T> | null> {
    const found = await this.find(store, type, id);
    if (!found || Date.now() <= found.record.expiresAt) return found;
    await store.delete(found.key);
    return null;
  }

  /** Write `record` under the hashed name of `id`, and delete the row it was read from when that was the old name. */
  private async replace<T extends { expiresAt: number }>(
    store: TypedStorage<T>,
    type: RecordType,
    id: string,
    found: FoundRecord<T>,
    record: T,
  ): Promise<void> {
    await store.set(this.key(type, id), record, this.ttl(record.expiresAt));
    if (found.legacy) await store.delete(found.key);
  }

  /** Delete the rows of `id` under both names, one key per call (a Redis Cluster may keep them on different nodes). */
  private async deleteBoth<T>(store: TypedStorage<T>, type: RecordType, id: string): Promise<void> {
    await Promise.all([store.delete(this.key(type, id)), store.delete(this.legacyKey(type, id))]);
  }

  /**
   * Replace the record of `id` with `update(record)` while `isLive(record)`, under its hashed name. The
   * compare-and-delete lets one request win: false when the record is missing or not live, or another request
   * changed it first. A record under the old name is claimed there, by deleting that row, and moves to the hashed
   * name; each step touches one key.
   */
  private async claim<T extends { expiresAt: number }>(
    store: TypedStorage<T>,
    type: RecordType,
    id: string,
    isLive: (record: T) => boolean,
    update: (record: T) => T,
  ): Promise<boolean> {
    const key = this.key(type, id);
    const raw = await this.base.get(key);
    if (raw !== null) return this.claimRow(store, key, key, raw, isLive, update);
    const legacyKey = this.legacyKey(type, id);
    const legacyRaw = await this.base.get(legacyKey);
    if (legacyRaw === null) return false;
    return this.claimRow(store, legacyKey, key, legacyRaw, isLive, update);
  }

  private async claimRow<T extends { expiresAt: number }>(
    store: TypedStorage<T>,
    from: string,
    to: string,
    raw: string,
    isLive: (record: T) => boolean,
    update: (record: T) => T,
  ): Promise<boolean> {
    const record = JSON.parse(raw) as T;
    if (!isLive(record) || !(await this.deleteIfEquals(from, raw))) return false;
    await store.set(to, update(record), this.ttl(record.expiresAt));
    return true;
  }

  /** Move the row under `key` when it is named by its value; see {@link moveLegacyRows}. */
  private async moveLegacyRow(type: RecordType, key: string): Promise<boolean> {
    const raw = await this.base.get(key);
    if (raw === null) return false;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }
    const id = record[NAMED_BY[type]];
    const expiresAt = record['expiresAt'];
    if (typeof id !== 'string' || typeof expiresAt !== 'number' || key !== this.legacyKey(type, id)) return false;
    if (!(await this.deleteIfEquals(key, raw)) || Date.now() > expiresAt) return false;
    // A row already under the hashed name is the newer one: it stays.
    await this.base.set(this.key(type, id), raw, { ...this.ttl(expiresAt), ifNotExists: true });
    return true;
  }

  /** Delete `key` only while it holds `expectedValue`, on an adapter that can do that in one step. */
  private deleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
    if (!this.base.deleteIfEquals) {
      throw new StorageNotSupportedError(
        'deleteIfEquals',
        'this storage adapter',
        'Use the memory, Redis, Upstash, Vercel KV or SQLite adapter, so an authorization code or refresh token is redeemed once.',
      );
    }
    return this.base.deleteIfEquals(key, expectedValue);
  }

  private ttl(expiresAtMs: number): { ttlSeconds: number } {
    const ttl = Math.ceil((expiresAtMs - Date.now()) / 1000);
    return { ttlSeconds: ttl > 0 ? ttl : 1 };
  }

  /** The row of `id`: named by the keyed hash of `id`. */
  private key(type: RecordType, id: string): string {
    return `${this.prefix(type)}${this.rowNames.name(id)}`;
  }

  /** The row of `id` as named up to 1.13, by `id` itself: read, and moved when used. */
  private legacyKey(type: RecordType, id: string): string {
    return `${this.prefix(type)}${id}`;
  }

  private prefix(type: RecordType): string {
    return this.storageIsNamespaced ? `${type}:` : `${this.namespace}:${type}:`;
  }

  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
