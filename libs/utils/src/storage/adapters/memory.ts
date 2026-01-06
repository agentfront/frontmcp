/**
 * Memory Storage Adapter
 *
 * In-memory storage implementation for development and testing.
 * Supports TTL, pattern matching, pub/sub via EventEmitter.
 */

import { EventEmitter } from 'events';
import { BaseStorageAdapter } from './base';
import type { MemoryAdapterOptions, SetOptions, MessageHandler, Unsubscribe } from '../types';
import { StorageOperationError } from '../errors';
import { globToRegex } from '../utils/pattern';
import { ttlToExpiresAt, isExpired, expiresAtToTTL, validateTTL } from '../utils/ttl';

/**
 * Internal entry structure for memory storage.
 */
interface MemoryEntry {
  value: string;
  expiresAt?: number;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Default sweep interval in seconds.
 */
const DEFAULT_SWEEP_INTERVAL_SECONDS = 60;

/**
 * Maximum TTL that can use setTimeout (Node.js limit ~24.8 days).
 */
const MAX_TIMEOUT_MS = 2147483647;

/**
 * In-memory storage adapter.
 *
 * Features:
 * - TTL support with lazy expiration + optional background sweeper
 * - Pattern matching for keys() with ReDoS protection
 * - Pub/sub via EventEmitter
 * - Optional LRU eviction
 *
 * @example
 * ```typescript
 * const adapter = new MemoryStorageAdapter({
 *   enableSweeper: true,
 *   sweepIntervalSeconds: 60,
 * });
 *
 * await adapter.connect();
 * await adapter.set('key', 'value', { ttlSeconds: 300 });
 * const value = await adapter.get('key');
 * await adapter.disconnect();
 * ```
 */
export class MemoryStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'memory';

  private readonly store = new Map<string, MemoryEntry>();
  private readonly emitter = new EventEmitter();
  private sweepInterval?: ReturnType<typeof setInterval>;
  private readonly options: Required<MemoryAdapterOptions>;

  // LRU tracking (simple linked list via insertion order in Map)
  private accessOrder: string[] = [];

  constructor(options: MemoryAdapterOptions = {}) {
    super();
    this.options = {
      enableSweeper: options.enableSweeper ?? true,
      sweepIntervalSeconds: options.sweepIntervalSeconds ?? DEFAULT_SWEEP_INTERVAL_SECONDS,
      maxEntries: options.maxEntries ?? 0, // 0 = unlimited
    };

    // Increase max listeners for pub/sub
    this.emitter.setMaxListeners(1000);
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    this.connected = true;

    // Start background sweeper if enabled
    if (this.options.enableSweeper && this.options.sweepIntervalSeconds > 0) {
      this.startSweeper();
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.stopSweeper();
    this.clearAllTimeouts();
    this.store.clear();
    this.accessOrder = [];
    this.emitter.removeAllListeners();
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    return this.connected;
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();

    const entry = this.store.get(key);
    if (!entry) return null;

    // Check expiration
    if (isExpired(entry.expiresAt)) {
      this.deleteEntry(key);
      return null;
    }

    // Update LRU order
    this.touchLRU(key);

    return entry.value;
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    // Handle conditional flags
    const existingEntry = this.store.get(key);
    const exists = existingEntry !== undefined && !isExpired(existingEntry.expiresAt);

    if (options?.ifNotExists && exists) {
      return; // NX: Don't set if exists
    }
    if (options?.ifExists && !exists) {
      return; // XX: Don't set if doesn't exist
    }

    // Clear any existing timeout
    this.clearEntryTimeout(key);

    // Create entry
    const entry: MemoryEntry = { value };

    if (options?.ttlSeconds) {
      entry.expiresAt = ttlToExpiresAt(options.ttlSeconds);

      // Set timeout for entries with short TTL
      const ttlMs = options.ttlSeconds * 1000;
      if (ttlMs < MAX_TIMEOUT_MS) {
        entry.timeout = setTimeout(() => {
          this.deleteEntry(key);
        }, ttlMs);

        // Unref to allow process exit
        if (entry.timeout.unref) {
          entry.timeout.unref();
        }
      }
    }

    // Check LRU eviction
    if (this.options.maxEntries > 0 && !this.store.has(key)) {
      while (this.store.size >= this.options.maxEntries) {
        this.evictOldest();
      }
    }

    this.store.set(key, entry);
    this.touchLRU(key);
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    return this.deleteEntry(key);
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();

    const entry = this.store.get(key);
    if (!entry) return false;

    if (isExpired(entry.expiresAt)) {
      this.deleteEntry(key);
      return false;
    }

    return true;
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    validateTTL(ttlSeconds);

    const entry = this.store.get(key);
    if (!entry || isExpired(entry.expiresAt)) {
      return false;
    }

    // Clear existing timeout
    this.clearEntryTimeout(key);

    // Set new expiration
    entry.expiresAt = ttlToExpiresAt(ttlSeconds);

    // Set new timeout for short TTLs
    const ttlMs = ttlSeconds * 1000;
    if (ttlMs < MAX_TIMEOUT_MS) {
      entry.timeout = setTimeout(() => {
        this.deleteEntry(key);
      }, ttlMs);

      if (entry.timeout.unref) {
        entry.timeout.unref();
      }
    }

    return true;
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();

    const entry = this.store.get(key);
    if (!entry) return null;

    if (isExpired(entry.expiresAt)) {
      this.deleteEntry(key);
      return null;
    }

    if (entry.expiresAt === undefined) {
      return -1; // No TTL
    }

    return expiresAtToTTL(entry.expiresAt);
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    this.ensureConnected();

    const regex = globToRegex(pattern);
    const result: string[] = [];

    for (const [key, entry] of this.store) {
      // Skip expired entries
      if (isExpired(entry.expiresAt)) {
        this.deleteEntry(key);
        continue;
      }

      if (regex.test(key)) {
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

  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();

    const entry = this.store.get(key);
    let currentValue = 0;

    if (entry && !isExpired(entry.expiresAt)) {
      const parsed = parseInt(entry.value, 10);
      if (isNaN(parsed)) {
        throw new StorageOperationError('incrBy', key, 'Value is not an integer');
      }
      currentValue = parsed;
    }

    const newValue = currentValue + amount;

    // Preserve TTL if exists
    const newEntry: MemoryEntry = { value: String(newValue) };
    if (entry?.expiresAt && !isExpired(entry.expiresAt)) {
      newEntry.expiresAt = entry.expiresAt;
      // Re-schedule timeout with remaining time
      const remainingMs = entry.expiresAt - Date.now();
      if (remainingMs > 0 && remainingMs < MAX_TIMEOUT_MS) {
        this.clearEntryTimeout(key);
        newEntry.timeout = setTimeout(() => {
          this.deleteEntry(key);
        }, remainingMs);
        if (newEntry.timeout.unref) {
          newEntry.timeout.unref();
        }
      }
    }

    this.store.set(key, newEntry);
    this.touchLRU(key);

    return newValue;
  }

  // ============================================
  // Pub/Sub
  // ============================================

  override supportsPubSub(): boolean {
    return true;
  }

  override async publish(channel: string, message: string): Promise<number> {
    this.ensureConnected();
    return this.emitter.listenerCount(channel) > 0
      ? (this.emitter.emit(channel, message, channel), this.emitter.listenerCount(channel))
      : 0;
  }

  override async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    this.ensureConnected();

    const wrappedHandler = (message: string, ch: string) => {
      handler(message, ch);
    };

    this.emitter.on(channel, wrappedHandler);

    return async () => {
      this.emitter.off(channel, wrappedHandler);
    };
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Delete an entry and clear its timeout.
   */
  private deleteEntry(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.clearEntryTimeout(key);
    this.store.delete(key);
    this.removeLRU(key);

    return true;
  }

  /**
   * Clear timeout for an entry.
   */
  private clearEntryTimeout(key: string): void {
    const entry = this.store.get(key);
    if (entry?.timeout) {
      clearTimeout(entry.timeout);
      entry.timeout = undefined;
    }
  }

  /**
   * Clear all timeouts.
   */
  private clearAllTimeouts(): void {
    for (const [key] of this.store) {
      this.clearEntryTimeout(key);
    }
  }

  /**
   * Update LRU access order.
   */
  private touchLRU(key: string): void {
    if (this.options.maxEntries <= 0) return;

    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Remove key from LRU tracking.
   */
  private removeLRU(key: string): void {
    if (this.options.maxEntries <= 0) return;

    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  /**
   * Evict oldest entry (LRU).
   */
  private evictOldest(): void {
    if (this.accessOrder.length === 0) return;

    const oldestKey = this.accessOrder.shift();
    if (oldestKey) {
      this.deleteEntry(oldestKey);
    }
  }

  /**
   * Start background sweeper.
   */
  private startSweeper(): void {
    this.sweepInterval = setInterval(() => {
      this.sweep();
    }, this.options.sweepIntervalSeconds * 1000);

    // Unref to allow process exit
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /**
   * Stop background sweeper.
   */
  private stopSweeper(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }

  /**
   * Sweep expired entries.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now >= entry.expiresAt) {
        this.deleteEntry(key);
      }
    }
  }

  // ============================================
  // Stats (for debugging)
  // ============================================

  /**
   * Get storage statistics.
   */
  getStats(): { size: number; maxEntries: number; sweeperActive: boolean } {
    return {
      size: this.store.size,
      maxEntries: this.options.maxEntries,
      sweeperActive: this.sweepInterval !== undefined,
    };
  }
}
