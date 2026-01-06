/**
 * Namespaced Storage Implementation
 *
 * Wraps a StorageAdapter to provide namespace prefixing.
 * All operations automatically prefix keys with the namespace path.
 */

import type { StorageAdapter, NamespacedStorage, SetOptions, SetEntry, MessageHandler, Unsubscribe } from './types';

/**
 * Separator used between namespace segments.
 */
export const NAMESPACE_SEPARATOR = ':';

/**
 * Build a namespace prefix from name and optional id.
 *
 * @param name - Namespace name (e.g., 'session', 'user')
 * @param id - Optional identifier (e.g., session ID, user ID)
 * @returns Prefix string with trailing separator
 *
 * @example
 * ```typescript
 * buildPrefix('session', 'abc123');  // 'session:abc123:'
 * buildPrefix('global');             // 'global:'
 * ```
 */
export function buildPrefix(name: string, id?: string): string {
  if (id) {
    return `${name}${NAMESPACE_SEPARATOR}${id}${NAMESPACE_SEPARATOR}`;
  }
  return `${name}${NAMESPACE_SEPARATOR}`;
}

/**
 * Implementation of NamespacedStorage.
 * Wraps a StorageAdapter and prefixes all keys.
 */
export class NamespacedStorageImpl implements NamespacedStorage {
  constructor(
    private readonly adapter: StorageAdapter,
    public readonly prefix = '',
    public readonly root: StorageAdapter = adapter,
  ) {}

  // ============================================
  // Key Prefixing Helpers
  // ============================================

  /**
   * Add prefix to a key.
   */
  private prefixKey(key: string): string {
    return this.prefix + key;
  }

  /**
   * Remove prefix from a key.
   */
  private unprefixKey(key: string): string {
    if (this.prefix && key.startsWith(this.prefix)) {
      return key.slice(this.prefix.length);
    }
    return key;
  }

  /**
   * Add prefix to a pattern (for keys() operation).
   */
  private prefixPattern(pattern: string): string {
    return this.prefix + pattern;
  }

  /**
   * Add prefix to a channel (for pub/sub).
   */
  private prefixChannel(channel: string): string {
    return this.prefix + channel;
  }

  // ============================================
  // Namespace API
  // ============================================

  namespace(name: string, id?: string): NamespacedStorage {
    const newPrefix = this.prefix + buildPrefix(name, id);
    return new NamespacedStorageImpl(this.adapter, newPrefix, this.root);
  }

  // ============================================
  // Connection Lifecycle (delegated to root)
  // ============================================

  async connect(): Promise<void> {
    return this.adapter.connect();
  }

  async disconnect(): Promise<void> {
    return this.adapter.disconnect();
  }

  async ping(): Promise<boolean> {
    return this.adapter.ping();
  }

  // ============================================
  // Core Operations (with prefixing)
  // ============================================

  async get(key: string): Promise<string | null> {
    return this.adapter.get(this.prefixKey(key));
  }

  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    return this.adapter.set(this.prefixKey(key), value, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.adapter.delete(this.prefixKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(this.prefixKey(key));
  }

  // ============================================
  // Batch Operations (with prefixing)
  // ============================================

  async mget(keys: string[]): Promise<(string | null)[]> {
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.adapter.mget(prefixedKeys);
  }

  async mset(entries: SetEntry[]): Promise<void> {
    const prefixedEntries = entries.map((e) => ({
      ...e,
      key: this.prefixKey(e.key),
    }));
    return this.adapter.mset(prefixedEntries);
  }

  async mdelete(keys: string[]): Promise<number> {
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.adapter.mdelete(prefixedKeys);
  }

  // ============================================
  // TTL Operations (with prefixing)
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return this.adapter.expire(this.prefixKey(key), ttlSeconds);
  }

  async ttl(key: string): Promise<number | null> {
    return this.adapter.ttl(this.prefixKey(key));
  }

  // ============================================
  // Key Enumeration (with prefixing)
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    const prefixedPattern = this.prefixPattern(pattern);
    const keys = await this.adapter.keys(prefixedPattern);
    // Remove prefix from returned keys
    return keys.map((k) => this.unprefixKey(k));
  }

  async count(pattern = '*'): Promise<number> {
    const prefixedPattern = this.prefixPattern(pattern);
    return this.adapter.count(prefixedPattern);
  }

  // ============================================
  // Atomic Operations (with prefixing)
  // ============================================

  async incr(key: string): Promise<number> {
    return this.adapter.incr(this.prefixKey(key));
  }

  async decr(key: string): Promise<number> {
    return this.adapter.decr(this.prefixKey(key));
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.adapter.incrBy(this.prefixKey(key), amount);
  }

  // ============================================
  // Pub/Sub (with channel prefixing)
  // ============================================

  async publish(channel: string, message: string): Promise<number> {
    return this.adapter.publish(this.prefixChannel(channel), message);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    const prefixedChannel = this.prefixChannel(channel);

    // Wrap handler to unprefixed channel name in callback
    const wrappedHandler: MessageHandler = (message, ch) => {
      const unprefixedChannel = ch.startsWith(this.prefix) ? ch.slice(this.prefix.length) : ch;
      handler(message, unprefixedChannel);
    };

    return this.adapter.subscribe(prefixedChannel, wrappedHandler);
  }

  supportsPubSub(): boolean {
    return this.adapter.supportsPubSub();
  }
}

/**
 * Create a root namespaced storage from an adapter.
 * The root has an empty prefix.
 *
 * @param adapter - Storage adapter to wrap
 * @returns RootStorage (NamespacedStorage with empty prefix)
 */
export function createRootStorage(adapter: StorageAdapter): NamespacedStorage {
  return new NamespacedStorageImpl(adapter, '', adapter);
}

/**
 * Create a namespaced storage with an initial prefix.
 *
 * @param adapter - Storage adapter to wrap
 * @param prefix - Initial prefix (without trailing separator)
 * @returns NamespacedStorage with the given prefix
 */
export function createNamespacedStorage(adapter: StorageAdapter, prefix: string): NamespacedStorage {
  // Ensure prefix ends with separator if not empty
  const normalizedPrefix = prefix && !prefix.endsWith(NAMESPACE_SEPARATOR) ? prefix + NAMESPACE_SEPARATOR : prefix;
  return new NamespacedStorageImpl(adapter, normalizedPrefix, adapter);
}
