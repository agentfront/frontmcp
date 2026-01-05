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
