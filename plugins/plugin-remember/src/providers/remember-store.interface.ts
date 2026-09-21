/**
 * Interface for Remember storage providers.
 * All providers must implement this interface.
 */
export interface RememberStoreInterface {
  /**
   * Store a value with optional TTL.
   * @param key - Storage key
   * @param value - Value to store (will be JSON serialized)
   * @param ttlSeconds - Optional time-to-live in seconds
   */
  setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void>;

  /**
   * Retrieve a value by key.
   * @param key - Storage key
   * @param defaultValue - Value to return if key doesn't exist
   * @returns The stored value or defaultValue
   */
  getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;

  /**
   * Store a value only if the key is absent.
   *
   * Optional. A store whose backend has no conditional write simply omits it, and callers that
   * need the guarantee fall back to read-then-write and say what that costs. Implement it
   * wherever the backend has a native primitive (Redis `SET ... NX`, Vercel KV `{ nx: true }`).
   *
   * @param key - Storage key
   * @param value - Value to store (will be JSON serialized)
   * @param ttlSeconds - Optional time-to-live in seconds
   * @returns true when this caller created the key, false when it already existed
   */
  setIfAbsent?(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>;

  /**
   * Delete a value by key.
   * @param key - Storage key to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists.
   * @param key - Storage key to check
   * @returns true if key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * List keys matching a pattern.
   * @param pattern - Glob-style pattern (e.g., "user:*")
   * @returns Array of matching keys
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * Gracefully close the storage connection.
   */
  close(): Promise<void>;
}
