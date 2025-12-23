// file: libs/browser/src/platform/storage.adapter.ts
/**
 * Browser implementation of PlatformStorage using localStorage/sessionStorage.
 */

import type { PlatformStorage } from '@frontmcp/sdk/core';

/**
 * Storage type for browser storage adapter.
 */
export type StorageType = 'local' | 'session' | 'memory';

/**
 * Options for browser storage adapter.
 */
export interface BrowserStorageOptions {
  /**
   * Type of storage to use.
   * - 'local': Uses localStorage (persists across sessions)
   * - 'session': Uses sessionStorage (clears on tab close)
   * - 'memory': Uses in-memory Map (clears on page refresh)
   * @default 'local'
   */
  type?: StorageType;

  /**
   * Prefix for all keys to avoid collisions.
   * @default 'frontmcp:'
   */
  prefix?: string;
}

/**
 * Browser storage adapter using localStorage, sessionStorage, or memory.
 *
 * @example
 * ```typescript
 * import { BrowserStorageAdapter } from '@frontmcp/browser';
 *
 * // Use localStorage (default)
 * const storage = new BrowserStorageAdapter();
 * await storage.set('key', 'value');
 *
 * // Use sessionStorage
 * const sessionStorage = new BrowserStorageAdapter({ type: 'session' });
 *
 * // Use in-memory storage
 * const memoryStorage = new BrowserStorageAdapter({ type: 'memory' });
 * ```
 */
export class BrowserStorageAdapter implements PlatformStorage {
  private readonly prefix: string;
  private storage: Storage | null;
  private readonly memoryStore: Map<string, string>;
  private readonly type: StorageType;

  constructor(options: BrowserStorageOptions = {}) {
    this.type = options.type ?? 'local';
    this.prefix = options.prefix ?? 'frontmcp:';
    this.memoryStore = new Map();
    this.storage = null;

    // Determine which storage to use
    if (this.type !== 'memory') {
      try {
        this.storage = this.type === 'session' ? sessionStorage : localStorage;
        // Test if storage is available
        const testKey = `${this.prefix}__test__`;
        this.storage.setItem(testKey, 'test');
        this.storage.removeItem(testKey);
      } catch {
        // Storage not available (e.g., private browsing mode)
        console.warn(`Browser ${this.type}Storage not available, falling back to memory storage`);
        this.storage = null;
      }
    }
  }

  /**
   * Get the prefixed key.
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Get a value by key.
   * Returns null if key doesn't exist.
   */
  async get(key: string): Promise<string | null> {
    const prefixedKey = this.getKey(key);

    if (this.storage) {
      return this.storage.getItem(prefixedKey);
    }

    return this.memoryStore.get(prefixedKey) ?? null;
  }

  /**
   * Set a value by key.
   */
  async set(key: string, value: string): Promise<void> {
    const prefixedKey = this.getKey(key);

    if (this.storage) {
      try {
        this.storage.setItem(prefixedKey, value);
      } catch (error) {
        // Handle quota exceeded
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          throw new Error('Storage quota exceeded');
        }
        throw error;
      }
    } else {
      this.memoryStore.set(prefixedKey, value);
    }
  }

  /**
   * Delete a value by key.
   */
  async delete(key: string): Promise<void> {
    const prefixedKey = this.getKey(key);

    if (this.storage) {
      this.storage.removeItem(prefixedKey);
    } else {
      this.memoryStore.delete(prefixedKey);
    }
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * Clear all stored values with this adapter's prefix.
   */
  async clear(): Promise<void> {
    if (this.storage) {
      // Only clear keys with our prefix
      const keysToRemove: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        this.storage.removeItem(key);
      }
    } else {
      // Clear memory store (only prefixed keys)
      for (const key of this.memoryStore.keys()) {
        if (key.startsWith(this.prefix)) {
          this.memoryStore.delete(key);
        }
      }
    }
  }

  /**
   * Get the storage type being used.
   */
  getStorageType(): StorageType {
    if (this.storage === null) {
      return 'memory';
    }
    return this.type;
  }

  /**
   * Check if native storage is available.
   */
  isNativeStorageAvailable(): boolean {
    return this.storage !== null;
  }
}

/**
 * Singleton instance of browser storage adapter (localStorage).
 */
export const browserStorage = new BrowserStorageAdapter();
