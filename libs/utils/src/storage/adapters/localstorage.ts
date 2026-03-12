/**
 * LocalStorage Storage Adapter
 *
 * Browser-compatible storage using the Web Storage API (localStorage).
 * Persistent across page reloads but limited to ~5MB per origin.
 *
 * Suitable for key persistence in browser environments where
 * simplicity is preferred over capacity.
 */

import { BaseStorageAdapter } from './base';
import type { SetOptions, MessageHandler, Unsubscribe } from '../types';

/**
 * Options for the LocalStorage adapter.
 */
export interface LocalStorageAdapterOptions {
  /**
   * Key prefix for namespacing.
   * @default 'frontmcp:'
   */
  prefix?: string;
}

/**
 * Internal entry structure for localStorage with TTL support.
 */
interface StoredEntry {
  v: string;
  e?: number; // expiresAt timestamp
}

/**
 * Browser localStorage-based storage adapter.
 *
 * Features:
 * - Persistent across page reloads
 * - Synchronous underlying API (async interface for consistency)
 * - TTL support via stored expiration timestamps
 * - Size-limited (~5MB per origin)
 *
 * Limitations:
 * - No pub/sub support
 * - No atomic increment/decrement
 * - String-only values (matches StorageAdapter contract)
 * - Pattern matching uses simple iteration
 */
export class LocalStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'localstorage';
  private readonly prefix: string;

  constructor(options?: LocalStorageAdapterOptions) {
    super();
    this.prefix = options?.prefix ?? 'frontmcp:';
  }

  private assertAvailable(): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available in this environment');
    }
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  private stripPrefix(fullKey: string): string {
    return fullKey.slice(this.prefix.length);
  }

  async connect(): Promise<void> {
    this.assertAvailable();
  }

  async disconnect(): Promise<void> {
    // No cleanup needed
  }

  async ping(): Promise<boolean> {
    try {
      this.assertAvailable();
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    const raw = localStorage.getItem(this.key(key));
    if (raw === null) return null;

    try {
      const entry: StoredEntry = JSON.parse(raw);
      if (entry.e && entry.e < Date.now()) {
        localStorage.removeItem(this.key(key));
        return null;
      }
      return entry.v;
    } catch {
      return null;
    }
  }

  override async set(key: string, value: string, options?: SetOptions): Promise<void> {
    if (options?.ifNotExists) {
      const existing = await this.get(key);
      if (existing !== null) return;
    }
    if (options?.ifExists) {
      const existing = await this.get(key);
      if (existing === null) return;
    }
    await this.doSet(key, value, options);
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    const entry: StoredEntry = { v: value };
    if (options?.ttlSeconds) {
      entry.e = Date.now() + options.ttlSeconds * 1000;
    }
    localStorage.setItem(this.key(key), JSON.stringify(entry));
  }

  async delete(key: string): Promise<boolean> {
    const existed = localStorage.getItem(this.key(key)) !== null;
    localStorage.removeItem(this.key(key));
    return existed;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  override async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  override async mset(entries: { key: string; value: string; options?: SetOptions }[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.options);
    }
  }

  override async mdelete(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (await this.delete(key)) count++;
    }
    return count;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const value = await this.get(key);
    if (value === null) return false;
    await this.set(key, value, { ttlSeconds });
    return true;
  }

  async ttl(key: string): Promise<number | null> {
    const raw = localStorage.getItem(this.key(key));
    if (raw === null) return null;

    try {
      const entry: StoredEntry = JSON.parse(raw);
      if (!entry.e) return -1;
      const remaining = Math.ceil((entry.e - Date.now()) / 1000);
      return remaining > 0 ? remaining : null;
    } catch {
      return null;
    }
  }

  async keys(pattern?: string): Promise<string[]> {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (fullKey && fullKey.startsWith(this.prefix)) {
        const key = this.stripPrefix(fullKey);
        if (!pattern || pattern === '*' || this.matchPattern(key, pattern)) {
          // Check if not expired
          if ((await this.get(key)) !== null) {
            result.push(key);
          }
        }
      }
    }
    return result;
  }

  override async count(pattern?: string): Promise<number> {
    return (await this.keys(pattern)).length;
  }

  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async decr(key: string): Promise<number> {
    return this.incrBy(key, -1);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    const current = await this.get(key);
    const value = current !== null ? parseInt(current, 10) + amount : amount;
    if (Number.isNaN(value)) {
      throw new Error(`Value at "${key}" is not an integer`);
    }
    await this.set(key, String(value));
    return value;
  }

  override async publish(): Promise<number> {
    throw new Error('LocalStorage adapter does not support pub/sub');
  }

  override async subscribe(_channel: string, _handler: MessageHandler): Promise<Unsubscribe> {
    throw new Error('LocalStorage adapter does not support pub/sub');
  }

  override supportsPubSub(): boolean {
    return false;
  }

  private matchPattern(key: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\*/g, '.*')
          .replace(/\\\?/g, '.') +
        '$',
    );
    return regex.test(key);
  }
}
