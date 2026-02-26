/**
 * SQLite Key-Value Store
 *
 * Core KV store built on better-sqlite3 with Redis-compatible interface.
 * Supports TTL expiration, optional encryption, and WAL mode.
 */

import type Database from 'better-sqlite3';
import { deriveEncryptionKey, encryptValue, decryptValue } from './encryption';
import type { SqliteStorageOptions } from './sqlite.options';

/** Bundled prepared statements - all-or-nothing initialization. */
interface KvPreparedStatements {
  get: Database.Statement;
  set: Database.Statement;
  del: Database.Statement;
  has: Database.Statement;
  keys: Database.Statement;
  keysPattern: Database.Statement;
  cleanup: Database.Statement;
  ttl: Database.Statement;
  expire: Database.Statement;
}

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
  private stmts: KvPreparedStatements | null = null;

  constructor(options: SqliteStorageOptions) {
    // Lazy require to avoid bundling when not used

    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    try {
      this.db = new BetterSqlite3(options.path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SqliteKvStore: failed to open database at "${options.path}": ${message}`);
    }

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
    this.stmts = {
      get: this.db.prepare('SELECT value, expires_at FROM kv WHERE key = ?'),
      set: this.db.prepare('INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)'),
      del: this.db.prepare('DELETE FROM kv WHERE key = ?'),
      has: this.db.prepare('SELECT 1 FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)'),
      keys: this.db.prepare('SELECT key FROM kv WHERE (expires_at IS NULL OR expires_at > ?)'),
      keysPattern: this.db.prepare('SELECT key FROM kv WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?)'),
      cleanup: this.db.prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?'),
      ttl: this.db.prepare('SELECT expires_at FROM kv WHERE key = ?'),
      expire: this.db.prepare('UPDATE kv SET expires_at = ? WHERE key = ?'),
    };
  }

  /**
   * Return prepared statements, throwing if not yet initialized.
   */
  private prepared(): KvPreparedStatements {
    if (!this.stmts) {
      throw new Error('SqliteKvStore: prepared statements not initialized. Was prepareStatements() called?');
    }
    return this.stmts;
  }

  /**
   * Get a value by key.
   * Returns null if key doesn't exist or is expired.
   */
  get(key: string): string | null {
    const stmts = this.prepared();
    const row = stmts.get.get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;

    // Check TTL
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      stmts.del.run(key);
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
    try {
      return JSON.parse(value) as T;
    } catch {
      // Return null if stored value is not valid JSON (e.g., corrupted or non-JSON string)
      return null;
    }
  }

  /**
   * Set a key-value pair with optional TTL.
   *
   * @param key - The key
   * @param value - The value to store
   * @param ttlMs - Time to live in milliseconds (optional)
   */
  set(key: string, value: string, ttlMs?: number): void {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;

    // Encrypt value if encryption is enabled
    const storedValue = this.encryptionKey ? encryptValue(this.encryptionKey, value) : value;

    this.prepared().set.run(key, storedValue, expiresAt);
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
    this.prepared().del.run(key);
  }

  /**
   * Check if a key exists (and is not expired).
   */
  has(key: string): boolean {
    const row = this.prepared().has.get(key, Date.now()) as { 1: number } | undefined;
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
    const stmts = this.prepared();
    const now = Date.now();
    let rows: { key: string }[];

    if (pattern) {
      rows = stmts.keysPattern.all(pattern, now) as { key: string }[];
    } else {
      rows = stmts.keys.all(now) as { key: string }[];
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
    const result = this.prepared().expire.run(expiresAt, key);
    return result.changes > 0;
  }

  /**
   * Get remaining TTL for a key in milliseconds.
   *
   * @returns TTL in ms, -1 if no expiry, -2 if key doesn't exist
   */
  ttl(key: string): number {
    const stmts = this.prepared();
    const row = stmts.ttl.get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;

    const remaining = row.expires_at - Date.now();
    if (remaining <= 0) {
      stmts.del.run(key);
      return -2;
    }

    return remaining;
  }

  /**
   * Purge all expired keys.
   * Called periodically by the cleanup timer.
   */
  purgeExpired(): number {
    const result = this.prepared().cleanup.run(Date.now());
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
