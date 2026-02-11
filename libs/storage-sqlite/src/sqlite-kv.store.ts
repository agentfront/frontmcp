/**
 * SQLite Key-Value Store
 *
 * Core KV store built on better-sqlite3 with Redis-compatible interface.
 * Supports TTL expiration, optional encryption, and WAL mode.
 */

import type Database from 'better-sqlite3';
import { deriveEncryptionKey, encryptValue, decryptValue } from './encryption';
import type { SqliteStorageOptions } from './sqlite.options';

/**
 * SQLite-backed key-value store with TTL support and optional encryption.
 *
 * Schema:
 * ```sql
 * CREATE TABLE IF NOT EXISTS kv (
 *   key        TEXT PRIMARY KEY,
 *   value      TEXT NOT NULL,
 *   expires_at INTEGER  -- Unix timestamp ms, NULL = no expiry
 * );
 * ```
 */
export class SqliteKvStore {
  private db: Database.Database;
  private encryptionKey: Uint8Array | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Prepared statements for performance
  private stmtGet!: Database.Statement;
  private stmtSet!: Database.Statement;
  private stmtDel!: Database.Statement;
  private stmtHas!: Database.Statement;
  private stmtKeys!: Database.Statement;
  private stmtKeysPattern!: Database.Statement;
  private stmtCleanup!: Database.Statement;
  private stmtTtl!: Database.Statement;
  private stmtExpire!: Database.Statement;

  constructor(options: SqliteStorageOptions) {
    // Lazy require to avoid bundling when not used
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new BetterSqlite3(options.path);

    // Enable WAL mode for better concurrency
    if (options.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    // Derive encryption key if secret provided
    if (options.encryption?.secret) {
      this.encryptionKey = deriveEncryptionKey(options.encryption.secret);
    }

    this.initSchema();
    this.prepareStatements();

    // Start periodic TTL cleanup
    const cleanupInterval = options.ttlCleanupIntervalMs ?? 60000;
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.purgeExpired(), cleanupInterval);
      // Allow the process to exit even if timer is running
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires_at) WHERE expires_at IS NOT NULL;
    `);
  }

  private prepareStatements(): void {
    this.stmtGet = this.db.prepare('SELECT value, expires_at FROM kv WHERE key = ?');
    this.stmtSet = this.db.prepare('INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)');
    this.stmtDel = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.stmtHas = this.db.prepare('SELECT 1 FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)');
    this.stmtKeys = this.db.prepare('SELECT key FROM kv WHERE (expires_at IS NULL OR expires_at > ?)');
    this.stmtKeysPattern = this.db.prepare(
      'SELECT key FROM kv WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?)',
    );
    this.stmtCleanup = this.db.prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?');
    this.stmtTtl = this.db.prepare('SELECT expires_at FROM kv WHERE key = ?');
    this.stmtExpire = this.db.prepare('UPDATE kv SET expires_at = ? WHERE key = ?');
  }

  /**
   * Get a value by key.
   * Returns null if key doesn't exist or is expired.
   */
  get(key: string): string | null {
    const row = this.stmtGet.get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;

    // Check TTL
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      this.stmtDel.run(key);
      return null;
    }

    // Decrypt if encryption is enabled
    if (this.encryptionKey) {
      return decryptValue(this.encryptionKey, row.value);
    }

    return row.value;
  }

  /**
   * Get a value and parse it as JSON.
   */
  getJSON<T = unknown>(key: string): T | null {
    const value = this.get(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  }

  /**
   * Set a key-value pair with optional TTL.
   *
   * @param key - The key
   * @param value - The value to store
   * @param ttlMs - Time to live in milliseconds (optional)
   */
  set(key: string, value: string, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;

    // Encrypt value if encryption is enabled
    const storedValue = this.encryptionKey ? encryptValue(this.encryptionKey, value) : value;

    this.stmtSet.run(key, storedValue, expiresAt);
  }

  /**
   * Set a key-value pair with JSON serialization and optional TTL.
   */
  setJSON(key: string, value: unknown, ttlMs?: number): void {
    this.set(key, JSON.stringify(value), ttlMs);
  }

  /**
   * Delete a key.
   */
  del(key: string): void {
    this.stmtDel.run(key);
  }

  /**
   * Check if a key exists (and is not expired).
   */
  has(key: string): boolean {
    const row = this.stmtHas.get(key, Date.now()) as { 1: number } | undefined;
    return row !== undefined;
  }

  /**
   * List keys matching an optional glob-like pattern.
   * Pattern uses SQL LIKE syntax: `%` for any characters, `_` for single character.
   *
   * @param pattern - Optional pattern (uses SQL LIKE). Without pattern, returns all keys.
   * @returns Array of matching key strings
   */
  keys(pattern?: string): string[] {
    const now = Date.now();
    let rows: { key: string }[];

    if (pattern) {
      rows = this.stmtKeysPattern.all(pattern, now) as { key: string }[];
    } else {
      rows = this.stmtKeys.all(now) as { key: string }[];
    }

    return rows.map((r) => r.key);
  }

  /**
   * Set TTL on an existing key.
   *
   * @param key - The key to set expiry on
   * @param ttlMs - Time to live in milliseconds
   * @returns true if key exists and TTL was set, false if key doesn't exist
   */
  expire(key: string, ttlMs: number): boolean {
    const expiresAt = Date.now() + ttlMs;
    const result = this.stmtExpire.run(expiresAt, key);
    return result.changes > 0;
  }

  /**
   * Get remaining TTL for a key in milliseconds.
   *
   * @returns TTL in ms, -1 if no expiry, -2 if key doesn't exist
   */
  ttl(key: string): number {
    const row = this.stmtTtl.get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;

    const remaining = row.expires_at - Date.now();
    if (remaining <= 0) {
      this.stmtDel.run(key);
      return -2;
    }

    return remaining;
  }

  /**
   * Purge all expired keys.
   * Called periodically by the cleanup timer.
   */
  purgeExpired(): number {
    const result = this.stmtCleanup.run(Date.now());
    return result.changes;
  }

  /**
   * Close the database connection and stop cleanup timer.
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.db.close();
  }

  /**
   * Get the underlying database instance (for advanced use cases / testing).
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}
