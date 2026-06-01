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
 * - All operations are backed by a single local SQLite file; "async" here just
 *   wraps synchronous better-sqlite3 calls in resolved promises.
 * - Pub/sub is NOT supported (single-process local file). Callers needing
 *   pub/sub must use Redis/Upstash.
 */

import { BaseStorageAdapter, type SetOptions } from '@frontmcp/utils';

import { SqliteKvStore } from './sqlite-kv.store';
import { type SqliteStorageOptions } from './sqlite.options';

export class SqliteStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'sqlite';

  private readonly kv: SqliteKvStore;

  constructor(options: SqliteStorageOptions | SqliteKvStore) {
    super();
    // Accept either raw options (we own the store) or an existing store.
    this.kv = options instanceof SqliteKvStore ? options : new SqliteKvStore(options);
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
    this.kv.close();
  }

  async ping(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      // A cheap no-op query to confirm the handle is alive.
      this.kv.has('__frontmcp_ping__');
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
    return this.kv.get(key);
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    // Honor conditional flags (NX/XX). BaseStorageAdapter.set() already
    // validated mutual exclusivity.
    if (options?.ifNotExists && this.kv.has(key)) {
      return;
    }
    if (options?.ifExists && !this.kv.has(key)) {
      return;
    }

    const ttlMs = options?.ttlSeconds !== undefined ? options.ttlSeconds * 1000 : undefined;
    this.kv.set(key, value, ttlMs);
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    const existed = this.kv.has(key);
    this.kv.del(key);
    return existed;
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    return this.kv.has(key);
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    return this.kv.expire(key, ttlSeconds * 1000);
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();
    // SqliteKvStore.ttl returns ms (-1 = no expiry, -2 = missing).
    const ms = this.kv.ttl(key);
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
    // Escape existing LIKE metacharacters so they are treated literally.
    if (pattern === '*' || pattern === undefined) {
      return this.kv.keys();
    }
    const like = pattern
      .replace(/[%_]/g, (c) => `\\${c}`)
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');
    return this.kv.keys(like);
  }

  // ============================================
  // Atomic Operations (read-modify-write; single-process local file)
  // ============================================

  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async decr(key: string): Promise<number> {
    return this.incrBy(key, -1);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();
    const current = this.kv.get(key);
    let base = 0;
    if (current !== null) {
      const parsed = Number.parseInt(current, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`SqliteStorageAdapter: value at "${key}" is not an integer`);
      }
      base = parsed;
    }
    const next = base + amount;
    // Preserve any existing TTL.
    const remainingMs = this.kv.ttl(key);
    this.kv.set(key, String(next), remainingMs > 0 ? remainingMs : undefined);
    return next;
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
