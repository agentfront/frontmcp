/**
 * IndexedDB Storage Adapter
 *
 * Browser-compatible storage using the IndexedDB API.
 * Persistent, supports larger data than localStorage (~50MB+ per origin).
 *
 * Suitable for key persistence in browser environments where
 * larger storage capacity is needed.
 */

import { BaseStorageAdapter } from './base';
import type { SetOptions } from '../types';
import { matchesPattern } from '../utils/pattern';

/**
 * Options for the IndexedDB adapter.
 */
export interface IndexedDBAdapterOptions {
  /**
   * Database name.
   * @default 'frontmcp'
   */
  dbName?: string;

  /**
   * Object store name.
   * @default 'kv'
   */
  storeName?: string;

  /**
   * Key prefix for namespacing.
   * @default 'frontmcp:'
   */
  prefix?: string;
}

/**
 * Internal entry structure for IndexedDB with TTL support.
 */
interface StoredEntry {
  /** Prefixed key (used as the IDB primary key). */
  k: string;
  /** Value. */
  v: string;
  /** Expiration timestamp (ms since epoch), undefined = no TTL. */
  e?: number;
}

/**
 * Browser IndexedDB-based storage adapter.
 *
 * Features:
 * - Persistent across page reloads and browser restarts
 * - Asynchronous API matching StorageAdapter contract
 * - TTL support via stored expiration timestamps
 * - Larger storage limit than localStorage (~50MB+)
 *
 * Limitations:
 * - No pub/sub support
 * - Browser-only (requires globalThis.indexedDB)
 * - Pattern matching uses simple iteration over all keys
 */
export class IndexedDBStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'indexeddb';
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly prefix: string;
  private db: IDBDatabase | null = null;

  constructor(options?: IndexedDBAdapterOptions) {
    super();
    this.dbName = options?.dbName ?? 'frontmcp';
    this.storeName = options?.storeName ?? 'kv';
    this.prefix = options?.prefix ?? 'frontmcp:';
  }

  private assertAvailable(): void {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment');
    }
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  private stripPrefix(fullKey: string): string {
    return fullKey.slice(this.prefix.length);
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    this.assertAvailable();
    if (this.db) {
      this.connected = true;
      return;
    }

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'k' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    return this.db !== null && this.connected;
  }

  // ============================================
  // Internal Helpers
  // ============================================

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) {
      throw new Error('IndexedDB adapter is not connected. Call connect() first.');
    }
    const tx = this.db.transaction(this.storeName, mode);
    return tx.objectStore(this.storeName);
  }

  private idbRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private idbTransaction(store: IDBObjectStore): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();

    const store = this.getStore('readonly');
    const entry = await this.idbRequest<StoredEntry | undefined>(store.get(this.key(key)));

    if (!entry) return null;

    if (entry.e && entry.e < Date.now()) {
      // Expired — fire-and-forget cleanup; failures are safe to ignore since
      // the entry is logically gone and will be cleaned up on next write.
      const writeStore = this.getStore('readwrite');
      writeStore.delete(this.key(key));
      return null;
    }

    return entry.v;
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    if (options?.ifNotExists) {
      const existing = await this.get(key);
      if (existing !== null) return;
    }
    if (options?.ifExists) {
      const existing = await this.get(key);
      if (existing === null) return;
    }

    const entry: StoredEntry = { k: this.key(key), v: value };
    if (options?.ttlSeconds) {
      entry.e = Date.now() + options.ttlSeconds * 1000;
    }

    const store = this.getStore('readwrite');
    await this.idbRequest(store.put(entry));
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();

    const existing = await this.get(key);
    if (existing === null) return false;

    const store = this.getStore('readwrite');
    await this.idbRequest(store.delete(this.key(key)));
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();

    const value = await this.get(key);
    if (value === null) return false;
    await this.doSet(key, value, { ttlSeconds });
    return true;
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();

    const store = this.getStore('readonly');
    const entry = await this.idbRequest<StoredEntry | undefined>(store.get(this.key(key)));

    if (!entry) return null;

    if (entry.e) {
      const remaining = Math.ceil((entry.e - Date.now()) / 1000);
      return remaining > 0 ? remaining : null;
    }

    return -1; // No TTL set
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern?: string): Promise<string[]> {
    this.ensureConnected();

    const store = this.getStore('readonly');
    const allKeys = await this.idbRequest<IDBValidKey[]>(store.getAllKeys());
    const now = Date.now();
    const result: string[] = [];

    for (const fullKey of allKeys) {
      const keyStr = String(fullKey);
      if (!keyStr.startsWith(this.prefix)) continue;

      const key = this.stripPrefix(keyStr);
      if (pattern && pattern !== '*' && !this.matchPattern(key, pattern)) continue;

      // Check expiration
      const entry = await this.idbRequest<StoredEntry | undefined>(store.get(keyStr));
      if (entry && (!entry.e || entry.e >= now)) {
        result.push(key);
      }
    }

    return result;
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

  /**
   * Increment by amount. NOT atomic — uses read-then-write which can race
   * under concurrent access (e.g., multiple browser tabs).
   */
  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();

    const current = await this.get(key);
    const value = current !== null ? parseInt(current, 10) + amount : amount;
    if (Number.isNaN(value)) {
      throw new Error(`Value at "${key}" is not an integer`);
    }
    await this.doSet(key, String(value));
    return value;
  }

  // ============================================
  // Pattern Matching
  // ============================================

  private matchPattern(key: string, pattern: string): boolean {
    return matchesPattern(key, pattern);
  }
}
