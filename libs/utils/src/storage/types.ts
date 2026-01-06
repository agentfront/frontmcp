/**
 * Unified Storage Abstraction Types
 *
 * Provides a common interface for key-value storage backends.
 * Supports Memory (dev), Redis (prod), Vercel KV (edge), and Upstash (edge + pub/sub).
 */

// ============================================
// Core Types
// ============================================

/**
 * Options for set operations.
 */
export interface SetOptions {
  /**
   * Time-to-live in seconds.
   * Must be a positive integer if provided.
   */
  ttlSeconds?: number;

  /**
   * Only set if key doesn't exist (NX in Redis).
   * Mutually exclusive with `ifExists`.
   */
  ifNotExists?: boolean;

  /**
   * Only set if key already exists (XX in Redis).
   * Mutually exclusive with `ifNotExists`.
   */
  ifExists?: boolean;
}

/**
 * Entry for batch set operations.
 */
export interface SetEntry {
  key: string;
  value: string;
  options?: SetOptions;
}

/**
 * Message handler for pub/sub subscriptions.
 */
export type MessageHandler = (message: string, channel: string) => void;

/**
 * Unsubscribe function returned by subscribe().
 */
export type Unsubscribe = () => Promise<void>;

// ============================================
// Storage Adapter Interface
// ============================================

/**
 * Unified storage adapter interface.
 *
 * All values are stored as strings - callers handle serialization.
 * This matches Redis behavior and provides consistent semantics across backends.
 *
 * @example
 * ```typescript
 * const adapter = new MemoryStorageAdapter();
 * await adapter.connect();
 *
 * // Store JSON data
 * await adapter.set('user:123', JSON.stringify({ name: 'John' }), { ttlSeconds: 3600 });
 *
 * // Retrieve and parse
 * const raw = await adapter.get('user:123');
 * const user = raw ? JSON.parse(raw) : null;
 *
 * await adapter.disconnect();
 * ```
 */
export interface StorageAdapter {
  // ============================================
  // Connection Lifecycle
  // ============================================

  /**
   * Initialize the storage connection.
   * For memory adapter, this is a no-op.
   * For Redis/Upstash, this establishes the connection.
   *
   * @throws StorageConnectionError if connection fails
   */
  connect(): Promise<void>;

  /**
   * Gracefully close the storage connection.
   * For memory adapter, clears data and stops timers.
   * For Redis, closes the connection (if owned by this adapter).
   */
  disconnect(): Promise<void>;

  /**
   * Check if storage is connected and healthy.
   *
   * @returns true if connected and responsive
   */
  ping(): Promise<boolean>;

  // ============================================
  // Core Operations
  // ============================================

  /**
   * Get a value by key.
   *
   * @param key - Storage key
   * @returns The value as string, or null if not found or expired
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value with optional TTL.
   *
   * @param key - Storage key
   * @param value - String value to store
   * @param options - Optional TTL and conditional flags
   * @throws StorageOperationError if operation fails
   */
  set(key: string, value: string, options?: SetOptions): Promise<void>;

  /**
   * Delete a key.
   *
   * @param key - Storage key
   * @returns true if key existed and was deleted, false otherwise
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists (and is not expired).
   *
   * @param key - Storage key
   * @returns true if key exists
   */
  exists(key: string): Promise<boolean>;

  // ============================================
  // Batch Operations
  // ============================================

  /**
   * Get multiple values.
   * Maintains order - returns null for missing keys.
   *
   * @param keys - Array of storage keys
   * @returns Array of values (null for missing keys)
   */
  mget(keys: string[]): Promise<(string | null)[]>;

  /**
   * Set multiple values atomically (where supported).
   * For memory adapter, operations are sequential.
   * For Redis, uses MSET/pipeline for atomicity.
   *
   * @param entries - Array of key-value-options entries
   */
  mset(entries: SetEntry[]): Promise<void>;

  /**
   * Delete multiple keys.
   *
   * @param keys - Array of storage keys
   * @returns Number of keys actually deleted
   */
  mdelete(keys: string[]): Promise<number>;

  // ============================================
  // TTL Operations
  // ============================================

  /**
   * Update TTL on an existing key.
   *
   * @param key - Storage key
   * @param ttlSeconds - New TTL in seconds (must be positive integer)
   * @returns true if key exists and TTL was set, false if key doesn't exist
   */
  expire(key: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Get remaining TTL for a key.
   *
   * @param key - Storage key
   * @returns TTL in seconds, -1 if no TTL, or null if key doesn't exist
   */
  ttl(key: string): Promise<number | null>;

  // ============================================
  // Key Enumeration
  // ============================================

  /**
   * List keys matching a pattern.
   * Pattern supports glob-style wildcards:
   * - `*` matches any sequence of characters
   * - `?` matches a single character
   *
   * @param pattern - Glob pattern (default: '*' for all keys)
   * @returns Array of matching keys
   *
   * @example
   * ```typescript
   * // Find all session keys
   * const sessionKeys = await adapter.keys('session:*');
   *
   * // Find keys with specific format
   * const userKeys = await adapter.keys('user:???:profile');
   * ```
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * Count keys matching a pattern.
   * More efficient than keys().length for large datasets.
   *
   * @param pattern - Glob pattern (default: '*' for all keys)
   * @returns Number of matching keys
   */
  count(pattern?: string): Promise<number>;

  // ============================================
  // Atomic Operations
  // ============================================

  /**
   * Atomically increment a numeric value.
   * Creates key with value 1 if it doesn't exist.
   *
   * @param key - Storage key
   * @returns New value after increment
   * @throws StorageOperationError if value is not a valid integer
   */
  incr(key: string): Promise<number>;

  /**
   * Atomically decrement a numeric value.
   * Creates key with value -1 if it doesn't exist.
   *
   * @param key - Storage key
   * @returns New value after decrement
   * @throws StorageOperationError if value is not a valid integer
   */
  decr(key: string): Promise<number>;

  /**
   * Atomically increment by a specific amount.
   * Creates key with value `amount` if it doesn't exist.
   *
   * @param key - Storage key
   * @param amount - Amount to increment (can be negative)
   * @returns New value after increment
   * @throws StorageOperationError if value is not a valid integer
   */
  incrBy(key: string, amount: number): Promise<number>;

  // ============================================
  // Pub/Sub (Optional)
  // ============================================

  /**
   * Publish a message to a channel.
   * Not all adapters support pub/sub (e.g., Vercel KV doesn't).
   *
   * @param channel - Channel name
   * @param message - Message string
   * @returns Number of subscribers that received the message
   * @throws StorageNotSupportedError if adapter doesn't support pub/sub
   */
  publish(channel: string, message: string): Promise<number>;

  /**
   * Subscribe to a channel.
   * Not all adapters support pub/sub (e.g., Vercel KV doesn't).
   *
   * @param channel - Channel name
   * @param handler - Function called when message is received
   * @returns Unsubscribe function
   * @throws StorageNotSupportedError if adapter doesn't support pub/sub
   */
  subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe>;

  /**
   * Check if this adapter supports pub/sub.
   *
   * @returns true if publish/subscribe are supported
   */
  supportsPubSub(): boolean;
}

// ============================================
// Namespaced Storage Interface
// ============================================

/**
 * A namespaced view of a storage adapter.
 * Automatically prefixes all keys with the namespace path.
 *
 * @example
 * ```typescript
 * const store = createStorage({ type: 'memory' });
 * await store.connect();
 *
 * // Create nested namespaces
 * const session = store.namespace('session', 'abc123');
 * // prefix: "session:abc123:"
 *
 * const user = session.namespace('user', '456');
 * // prefix: "session:abc123:user:456:"
 *
 * await user.set('theme', 'dark');
 * // Actual key: "session:abc123:user:456:theme"
 * ```
 */
export interface NamespacedStorage extends StorageAdapter {
  /**
   * The full namespace prefix (e.g., "session:abc123:user:456:").
   * Empty string for root storage.
   */
  readonly prefix: string;

  /**
   * Create a child namespace.
   * Keys become: {parentPrefix}{name}:{id}:{key}
   *
   * @param name - Namespace name (e.g., 'session', 'user')
   * @param id - Optional identifier (e.g., session ID, user ID)
   * @returns A new NamespacedStorage with extended prefix
   */
  namespace(name: string, id?: string): NamespacedStorage;

  /**
   * Get the underlying root adapter (for advanced use).
   * Use with caution - operations bypass namespace prefixing.
   */
  readonly root: StorageAdapter;
}

/**
 * Root storage with namespace capability.
 * The root itself has an empty prefix.
 */
export type RootStorage = NamespacedStorage;

// ============================================
// Adapter Options
// ============================================

/**
 * Options for memory storage adapter.
 */
export interface MemoryAdapterOptions {
  /**
   * Enable periodic sweeping of expired entries.
   * @default true
   */
  enableSweeper?: boolean;

  /**
   * Sweep interval in seconds.
   * @default 60
   */
  sweepIntervalSeconds?: number;

  /**
   * Maximum number of entries (LRU eviction when exceeded).
   * @default unlimited (0)
   */
  maxEntries?: number;
}

/**
 * Options for Redis storage adapter.
 */
export interface RedisAdapterOptions {
  /**
   * Use an existing Redis client (we won't close it).
   * Mutually exclusive with `config` and `url`.
   */
  client?: unknown; // Redis type from ioredis

  /**
   * Redis connection configuration.
   * Mutually exclusive with `client`.
   */
  config?: {
    host: string;
    port?: number;
    password?: string;
    db?: number;
    tls?: boolean;
  };

  /**
   * Redis connection URI.
   * e.g., "redis://user:pass@host:6379/0"
   * Mutually exclusive with `client`.
   */
  url?: string;

  /**
   * Key prefix applied to all keys.
   * @default ''
   */
  keyPrefix?: string;
}

/**
 * Options for Vercel KV storage adapter.
 * Note: Vercel KV does NOT support pub/sub.
 */
export interface VercelKvAdapterOptions {
  /**
   * KV REST API URL.
   * @default process.env.KV_REST_API_URL
   */
  url?: string;

  /**
   * KV REST API Token.
   * @default process.env.KV_REST_API_TOKEN
   */
  token?: string;

  /**
   * Key prefix applied to all keys.
   * @default ''
   */
  keyPrefix?: string;
}

/**
 * Options for Upstash Redis storage adapter.
 * Upstash supports pub/sub via REST API.
 */
export interface UpstashAdapterOptions {
  /**
   * Upstash Redis REST URL.
   * @default process.env.UPSTASH_REDIS_REST_URL
   */
  url?: string;

  /**
   * Upstash Redis REST Token.
   * @default process.env.UPSTASH_REDIS_REST_TOKEN
   */
  token?: string;

  /**
   * Key prefix applied to all keys.
   * @default ''
   */
  keyPrefix?: string;

  /**
   * Enable pub/sub support.
   * When enabled, creates additional connections for subscriptions.
   * @default false
   */
  enablePubSub?: boolean;
}

// ============================================
// Factory Types
// ============================================

/**
 * Storage backend type.
 */
export type StorageType = 'memory' | 'redis' | 'vercel-kv' | 'upstash' | 'auto';

/**
 * Configuration for createStorage factory.
 */
export interface StorageConfig {
  /**
   * Storage backend type.
   * - 'memory': In-memory (development/testing)
   * - 'redis': Redis (production)
   * - 'vercel-kv': Vercel KV (edge deployment, no pub/sub)
   * - 'upstash': Upstash Redis (edge deployment, with pub/sub)
   * - 'auto': Auto-detect based on environment variables
   * @default 'auto'
   */
  type?: StorageType;

  /**
   * Memory adapter options (when type='memory').
   */
  memory?: MemoryAdapterOptions;

  /**
   * Redis adapter options (when type='redis').
   */
  redis?: RedisAdapterOptions;

  /**
   * Vercel KV adapter options (when type='vercel-kv').
   */
  vercelKv?: VercelKvAdapterOptions;

  /**
   * Upstash adapter options (when type='upstash').
   */
  upstash?: UpstashAdapterOptions;

  /**
   * Root namespace prefix for all keys.
   * Applied on top of any adapter-specific prefix.
   * @default ''
   */
  prefix?: string;

  /**
   * Fallback behavior when preferred backend is unavailable.
   * - 'error': Throw error (default for production)
   * - 'memory': Fall back to memory with warning
   * @default 'error' in production (NODE_ENV=production), 'memory' otherwise
   */
  fallback?: 'error' | 'memory';
}
