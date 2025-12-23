// file: libs/sdk/src/platform/types.ts
/**
 * Platform abstraction interfaces for cross-environment compatibility.
 *
 * These interfaces define the contracts for platform-specific functionality
 * that differs between Node.js and browser environments.
 */

/**
 * Platform-agnostic crypto interface.
 * Browser: Uses Web Crypto API
 * Node.js: Uses node:crypto
 */
export interface PlatformCrypto {
  /**
   * Generate a random UUID (v4).
   */
  randomUUID(): string;

  /**
   * Fill a Uint8Array with cryptographically secure random values.
   */
  getRandomValues(array: Uint8Array): Uint8Array;

  /**
   * Generate random bytes as a hex string.
   */
  getRandomHex(length: number): string;

  /**
   * Compute SHA-256 hash of input data.
   * Returns hex-encoded hash string.
   */
  sha256(data: string | Uint8Array): Promise<string>;
}

/**
 * Platform-agnostic storage interface.
 * Browser: Uses localStorage/IndexedDB
 * Node.js: Uses file system or Redis
 */
export interface PlatformStorage {
  /**
   * Get a value by key.
   * Returns null if key doesn't exist.
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value by key.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete a value by key.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all stored values.
   */
  clear(): Promise<void>;
}

/**
 * Platform-agnostic context storage interface.
 * Browser: Uses simple context passing (single-threaded)
 * Node.js: Uses AsyncLocalStorage
 */
export interface PlatformContextStorage<T> {
  /**
   * Run a function within a context.
   */
  run<R>(context: T, fn: () => R): R;

  /**
   * Get the current context value.
   * Returns undefined if not in a context.
   */
  getStore(): T | undefined;

  /**
   * Check if currently running within a context.
   */
  hasContext(): boolean;
}

/**
 * Platform configuration for SDK initialization.
 */
export interface PlatformConfig {
  /**
   * Crypto implementation for the platform.
   */
  crypto?: PlatformCrypto;

  /**
   * Storage implementation for the platform.
   */
  storage?: PlatformStorage;

  /**
   * Whether running in browser environment.
   */
  isBrowser: boolean;

  /**
   * Whether running in development mode.
   */
  isDevelopment: boolean;
}

/**
 * Logger interface for cross-platform logging.
 */
export interface PlatformLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  verbose(message: string, ...args: unknown[]): void;
}
