/**
 * SQLite Session Store
 *
 * Implements the SessionStore interface using SQLite KV store.
 * Uses key-prefix namespace isolation for session data.
 */

import { randomUUID } from '@frontmcp/utils';
import { SqliteKvStore } from './sqlite-kv.store';
import type { SqliteStorageOptions } from './sqlite.options';

/**
 * Session store interface (matching @frontmcp/sdk SessionStore).
 * Redeclared here to avoid hard dependency on @frontmcp/sdk.
 */
export interface SessionStoreInterface {
  get(sessionId: string): Promise<StoredSessionData | null>;
  set(sessionId: string, session: StoredSessionData, ttlMs?: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
  allocId(): string;
}

/**
 * Stored session data type.
 * This is a generic JSON-serializable record that matches StoredSession from SDK.
 */
export type StoredSessionData = Record<string, unknown>;

export interface SqliteSessionStoreOptions extends SqliteStorageOptions {
  /** Key prefix for session keys. @default 'mcp:session:' */
  keyPrefix?: string;
  /** Default TTL for sessions in milliseconds. @default 3600000 (1 hour) */
  defaultTtlMs?: number;
}

/**
 * SQLite-backed session store.
 * Stores sessions as JSON in the SQLite KV store with TTL support.
 */
export class SqliteSessionStore implements SessionStoreInterface {
  private kv: SqliteKvStore;
  private keyPrefix: string;
  private defaultTtlMs: number;

  constructor(options: SqliteSessionStoreOptions) {
    this.kv = new SqliteKvStore(options);
    this.keyPrefix = options.keyPrefix ?? 'mcp:session:';
    this.defaultTtlMs = options.defaultTtlMs ?? 3600000;
  }

  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async get(sessionId: string): Promise<StoredSessionData | null> {
    return this.kv.getJSON<StoredSessionData>(this.sessionKey(sessionId));
  }

  async set(sessionId: string, session: StoredSessionData, ttlMs?: number): Promise<void> {
    this.kv.setJSON(this.sessionKey(sessionId), session, ttlMs ?? this.defaultTtlMs);
  }

  async delete(sessionId: string): Promise<void> {
    this.kv.del(this.sessionKey(sessionId));
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.kv.has(this.sessionKey(sessionId));
  }

  allocId(): string {
    return randomUUID();
  }

  /**
   * Close the underlying SQLite connection.
   */
  close(): void {
    this.kv.close();
  }

  /**
   * Get the underlying KV store (for testing/advanced use).
   */
  getKvStore(): SqliteKvStore {
    return this.kv;
  }
}
