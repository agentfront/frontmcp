/**
 * Base Storage Adapter
 *
 * Abstract base class for storage adapters.
 * Provides common validation and default implementations.
 */

import type { StorageAdapter, SetOptions, SetEntry, MessageHandler, Unsubscribe } from '../types';
import { StorageNotConnectedError, StorageNotSupportedError } from '../errors';
import { validateOptionalTTL } from '../utils/ttl';

/**
 * Abstract base class for storage adapters.
 * Subclasses must implement the abstract methods.
 */
export abstract class BaseStorageAdapter implements StorageAdapter {
  /**
   * Backend name for error messages (e.g., 'memory', 'redis').
   */
  protected abstract readonly backendName: string;

  /**
   * Whether the adapter is currently connected.
   */
  protected connected = false;

  // ============================================
  // Connection Lifecycle
  // ============================================

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract ping(): Promise<boolean>;

  /**
   * Ensure adapter is connected before operations.
   * @throws StorageNotConnectedError if not connected
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new StorageNotConnectedError(this.backendName);
    }
  }

  // ============================================
  // Core Operations
  // ============================================

  abstract get(key: string): Promise<string | null>;

  /**
   * Set with validation.
   */
  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    this.ensureConnected();
    this.validateSetOptions(options);
    return this.doSet(key, value, options);
  }

  /**
   * Internal set implementation. Override in subclass.
   */
  protected abstract doSet(key: string, value: string, options?: SetOptions): Promise<void>;

  abstract delete(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;

  // ============================================
  // Batch Operations (default implementations)
  // ============================================

  /**
   * Default mget: sequential gets.
   * Override for more efficient implementations.
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    this.ensureConnected();
    return Promise.all(keys.map((k) => this.get(k)));
  }

  /**
   * Default mset: sequential sets.
   * Override for atomic/pipelined implementations.
   */
  async mset(entries: SetEntry[]): Promise<void> {
    this.ensureConnected();
    for (const entry of entries) {
      this.validateSetOptions(entry.options);
    }
    await Promise.all(entries.map((e) => this.doSet(e.key, e.value, e.options)));
  }

  /**
   * Default mdelete: sequential deletes.
   * Override for more efficient implementations.
   */
  async mdelete(keys: string[]): Promise<number> {
    this.ensureConnected();
    const results = await Promise.all(keys.map((k) => this.delete(k)));
    return results.filter(Boolean).length;
  }

  // ============================================
  // TTL Operations
  // ============================================

  abstract expire(key: string, ttlSeconds: number): Promise<boolean>;
  abstract ttl(key: string): Promise<number | null>;

  // ============================================
  // Key Enumeration
  // ============================================

  abstract keys(pattern?: string): Promise<string[]>;

  /**
   * Default count: keys().length.
   * Override for more efficient implementations.
   */
  async count(pattern: string = '*'): Promise<number> {
    const matchedKeys = await this.keys(pattern);
    return matchedKeys.length;
  }

  // ============================================
  // Atomic Operations
  // ============================================

  abstract incr(key: string): Promise<number>;
  abstract decr(key: string): Promise<number>;
  abstract incrBy(key: string, amount: number): Promise<number>;

  // ============================================
  // Pub/Sub (default: not supported)
  // ============================================

  /**
   * Default: pub/sub not supported.
   * Override in adapters that support it.
   */
  supportsPubSub(): boolean {
    return false;
  }

  /**
   * Default: throw not supported error.
   * Override in adapters that support pub/sub.
   */
  async publish(_channel: string, _message: string): Promise<number> {
    throw new StorageNotSupportedError('publish', this.backendName, this.getPubSubSuggestion());
  }

  /**
   * Default: throw not supported error.
   * Override in adapters that support pub/sub.
   */
  async subscribe(_channel: string, _handler: MessageHandler): Promise<Unsubscribe> {
    throw new StorageNotSupportedError('subscribe', this.backendName, this.getPubSubSuggestion());
  }

  /**
   * Get suggestion message for pub/sub not supported error.
   * Override in specific adapters.
   */
  protected getPubSubSuggestion(): string {
    return 'Use Redis or Upstash adapter for pub/sub support.';
  }

  // ============================================
  // Validation Helpers
  // ============================================

  /**
   * Validate set options.
   */
  protected validateSetOptions(options?: SetOptions): void {
    if (!options) return;

    // Validate TTL
    validateOptionalTTL(options.ttlSeconds);

    // Check mutually exclusive flags
    if (options.ifNotExists && options.ifExists) {
      throw new Error('ifNotExists and ifExists are mutually exclusive');
    }
  }
}
