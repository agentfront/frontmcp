import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createStorage,
  createMemoryStorage,
  type RootStorage,
  type NamespacedStorage,
  type StorageConfig,
} from '@frontmcp/utils';
import type { RememberStoreInterface } from './remember-store.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for RememberStorageProvider.
 */
export interface RememberStorageProviderOptions {
  /**
   * Storage configuration. If not provided, uses auto-detection.
   * @default { type: 'auto' }
   */
  storage?: StorageConfig;

  /**
   * Use an existing storage instance instead of creating a new one.
   * Takes precedence over `storage` config.
   */
  storageInstance?: RootStorage | NamespacedStorage;

  /**
   * Namespace prefix for remember keys.
   * @default 'remember'
   */
  namespace?: string;

  /**
   * Default TTL in seconds for values without explicit TTL.
   * @default undefined (no default TTL)
   */
  defaultTTLSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RememberStorageProvider Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage-backed implementation of the RememberStoreInterface.
 * Works with any storage backend (memory, Redis, Vercel KV, Upstash).
 *
 * @example Memory storage (development)
 * ```typescript
 * const provider = new RememberStorageProvider();
 * await provider.initialize();
 * await provider.setValue('key', { data: 'value' });
 * ```
 *
 * @example Redis storage (production)
 * ```typescript
 * const provider = new RememberStorageProvider({
 *   storage: { type: 'redis', redis: { url: 'redis://localhost:6379' } }
 * });
 * await provider.initialize();
 * ```
 *
 * @example Auto-detection from environment
 * ```typescript
 * // Will use Redis if REDIS_URL is set, otherwise memory
 * const provider = new RememberStorageProvider({ storage: { type: 'auto' } });
 * await provider.initialize();
 * ```
 *
 * @example With existing storage instance
 * ```typescript
 * const rootStorage = await createStorage({ type: 'redis' });
 * const provider = new RememberStorageProvider({
 *   storageInstance: rootStorage.namespace('myapp')
 * });
 * await provider.initialize();
 * ```
 */
@Provider({
  name: 'provider:remember:storage',
  description: 'Storage-backed provider for RememberPlugin (supports Memory, Redis, Vercel KV, Upstash)',
  scope: ProviderScope.GLOBAL,
})
export class RememberStorageProvider implements RememberStoreInterface {
  private storage!: NamespacedStorage;
  private readonly options: Required<Omit<RememberStorageProviderOptions, 'storageInstance' | 'defaultTTLSeconds'>> & {
    storageInstance?: RootStorage | NamespacedStorage;
    defaultTTLSeconds?: number;
  };
  private initialized = false;
  private ownedStorage = false;

  constructor(options: RememberStorageProviderOptions = {}) {
    this.options = {
      storage: options.storage ?? { type: 'auto' },
      storageInstance: options.storageInstance,
      namespace: options.namespace ?? 'remember',
      defaultTTLSeconds: options.defaultTTLSeconds,
    };
  }

  /**
   * Initialize the storage connection.
   * Must be called before using the provider.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Use provided storage instance or create new one
    if (this.options.storageInstance) {
      this.storage = this.options.storageInstance.namespace(this.options.namespace);
      this.ownedStorage = false;
    } else {
      const rootStorage = await createStorage(this.options.storage);
      this.storage = rootStorage.namespace(this.options.namespace);
      this.ownedStorage = true;
    }

    this.initialized = true;
  }

  /**
   * Ensure initialization before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RememberStorageProvider not initialized. Call initialize() first.');
    }
  }

  /**
   * Store a value with optional TTL.
   * @param key - Storage key
   * @param value - Value to store (will be JSON serialized)
   * @param ttlSeconds - Optional time-to-live in seconds
   */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.ensureInitialized();

    // Validate value is not undefined
    if (value === undefined) {
      throw new Error('Cannot store undefined value. Use null or delete the key instead.');
    }

    // Validate ttlSeconds if provided
    if (ttlSeconds !== undefined) {
      if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
        throw new Error(`Invalid TTL: expected a number, got ${typeof ttlSeconds}`);
      }
      if (ttlSeconds <= 0) {
        throw new Error(`Invalid TTL: must be positive, got ${ttlSeconds}`);
      }
      if (!Number.isInteger(ttlSeconds)) {
        throw new Error(`Invalid TTL: must be an integer, got ${ttlSeconds}`);
      }
    }

    // JSON serialize the value
    const strValue = JSON.stringify(value);

    // Use provided TTL, or default, or none
    const effectiveTTL = ttlSeconds ?? this.options.defaultTTLSeconds;

    await this.storage.set(key, strValue, {
      ttlSeconds: effectiveTTL,
    });
  }

  /**
   * Retrieve a value by key.
   * @param key - Storage key
   * @param defaultValue - Value to return if key doesn't exist
   * @returns The stored value or defaultValue
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    this.ensureInitialized();

    const raw = await this.storage.get(key);

    if (raw === null) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Return defaultValue for malformed data
      return defaultValue;
    }
  }

  /**
   * Delete a value by key.
   * @param key - Storage key to delete
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();
    await this.storage.delete(key);
  }

  /**
   * Check if a key exists.
   * @param key - Storage key to check
   * @returns true if key exists
   */
  async exists(key: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage.exists(key);
  }

  /**
   * List keys matching a pattern.
   * @param pattern - Glob-style pattern (e.g., "user:*")
   * @returns Array of matching keys
   */
  async keys(pattern?: string): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage.keys(pattern ?? '*');
  }

  /**
   * Gracefully close the storage connection.
   */
  async close(): Promise<void> {
    // Only disconnect if we own the storage
    if (this.ownedStorage && this.storage) {
      await this.storage.root.disconnect();
    }

    this.initialized = false;
  }
}

/**
 * Create a RememberStorageProvider with synchronous memory storage.
 * Convenience function for simple use cases.
 *
 * @example
 * ```typescript
 * const provider = createRememberMemoryProvider();
 * // No need to call initialize() - storage is already connected
 * await provider.setValue('key', { data: 'value' });
 * ```
 */
export function createRememberMemoryProvider(
  options: Omit<RememberStorageProviderOptions, 'storage' | 'storageInstance'> = {},
): RememberStorageProvider {
  const memoryStorage = createMemoryStorage();
  return new RememberStorageProvider({
    ...options,
    storageInstance: memoryStorage,
  });
}
