/**
 * SqliteStorageAdapter
 *
 * Adapts the synchronous {@link SqliteKvStore} to the async `StorageAdapter`
 * contract from `@frontmcp/utils`, so SQLite can be used anywhere a
 * StorageAdapter is expected (e.g. `StorageTokenStore`, `StorageAuthorizationVault`,
 * and the auth token-storage factory).
 *
 * Extends `BaseStorageAdapter` to inherit the batch (`mget`/`mset`/`mdelete`),
 * `count`, and "pub/sub not supported" defaults. Only the SQLite-specific core
 * is implemented here.
 *
 * Notes:
 * - Every operation runs on the connection this process shares for the file, in call
 *   order. One that reads and then writes (conditional set, incr, compare-and-act) runs
 *   in a single `BEGIN IMMEDIATE` transaction, so it is atomic across processes too.
 * - Waiting for another process's lock does not block the event loop (see `SqliteConnection`).
 * - Pub/sub is NOT supported. Callers needing pub/sub must use Redis/Upstash.
 */

import { BaseStorageAdapter, StorageOperationError, validateTTL, type SetOptions } from '@frontmcp/utils';

import { type SqliteConnection } from './sqlite-connection';
import { SqliteKvStore } from './sqlite-kv.store';
import { type SqliteStorageOptions } from './sqlite.options';

export class SqliteStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'sqlite';

  private readonly kv: SqliteKvStore;

  private readonly connection: SqliteConnection;

  /**
   * Whether this adapter created (and therefore owns the lifecycle of) `kv`.
   * When the store is passed in by the caller, closing it is the caller's
   * responsibility — `disconnect()` must not pull the rug out from under it.
   */
  private readonly ownsKvStore: boolean;

  constructor(options: SqliteStorageOptions | SqliteKvStore) {
    super();
    // Accept either raw options (we own the store) or an existing store.
    this.ownsKvStore = !(options instanceof SqliteKvStore);
    this.kv = options instanceof SqliteKvStore ? options : new SqliteKvStore(options);
    this.connection = this.kv.getConnection();
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    // SqliteKvStore opens the database in its constructor; nothing to do.
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    // Only close the KV store if we own it. When an external SqliteKvStore was
    // injected, its owner is responsible for closing it (and may still be using
    // it via another adapter), so we leave the handle open.
    if (this.ownsKvStore) {
      await this.connection.idle();
      this.kv.close();
    }
  }

  async ping(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      // A cheap no-op query to confirm the handle is alive.
      await this.connection.read(() => this.kv.has('__frontmcp_ping__'));
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    return this.connection.read(() => this.kv.get(key));
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    // BaseStorageAdapter.set() already validated the TTL and that NX and XX are exclusive.
    const ttlMs = options?.ttlSeconds !== undefined ? options.ttlSeconds * 1000 : undefined;
    return this.connection.write(() => {
      if (options?.ifNotExists && this.kv.has(key)) return;
      if (options?.ifExists && !this.kv.has(key)) return;
      this.kv.set(key, value, ttlMs);
    });
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    return this.connection.write(() => {
      const existed = this.kv.has(key);
      this.kv.del(key);
      return existed;
    });
  }

  override async deleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
    this.ensureConnected();
    return this.connection.write(() => {
      if (this.kv.get(key) !== expectedValue) return false;
      this.kv.del(key);
      return true;
    });
  }

  override async expireIfEquals(key: string, expectedValue: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    validateTTL(ttlSeconds);
    return this.connection.write(() => this.kv.get(key) === expectedValue && this.kv.expire(key, ttlSeconds * 1000));
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    return this.connection.read(() => this.kv.has(key));
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    validateTTL(ttlSeconds);
    return this.connection.write(() => this.kv.expire(key, ttlSeconds * 1000));
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();
    // SqliteKvStore.ttl returns ms (-1 = no expiry, -2 = missing).
    const ms = await this.connection.read(() => this.kv.ttl(key));
    if (ms === -2) return null; // key does not exist
    if (ms === -1) return -1; // no expiry
    return Math.max(0, Math.ceil(ms / 1000));
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    this.ensureConnected();
    // Translate glob (`*`/`?`) to SQL LIKE (`%`/`_`). `*` => `%`, `?` => `_`.
    // Existing LIKE metacharacters are escaped as `\%`/`\_`; SqliteKvStore's
    // LIKE query declares `ESCAPE '\'` so these are matched literally.
    if (pattern === '*' || pattern === undefined) {
      return this.connection.read(() => this.kv.keys());
    }
    const like = pattern
      .replace(/[%_]/g, (c) => `\\${c}`)
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');
    return this.connection.read(() => this.kv.keys(like));
  }

  // ============================================
  // Atomic Operations
  // ============================================

  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async decr(key: string): Promise<number> {
    return this.incrBy(key, -1);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();
    return this.connection.write(() => {
      const current = this.kv.get(key);
      const base = current === null ? 0 : Number.parseInt(current, 10);
      if (Number.isNaN(base)) throw new StorageOperationError('incrBy', key, 'Value is not an integer');
      const next = base + amount;
      // Preserve any existing TTL.
      const remainingMs = this.kv.ttl(key);
      this.kv.set(key, String(next), remainingMs > 0 ? remainingMs : undefined);
      return next;
    });
  }

  /**
   * Expose the underlying KV store (advanced use / tests).
   */
  getKvStore(): SqliteKvStore {
    return this.kv;
  }

  protected override getPubSubSuggestion(): string {
    return 'SQLite adapter does not support pub/sub. Use Redis or Upstash for pub/sub support.';
  }
}
