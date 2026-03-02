/**
 * Store Plugin Types
 *
 * @packageDocumentation
 */

/**
 * Generic reactive store adapter.
 * Any store that implements this interface can be used with StorePlugin.
 */
export interface StoreAdapter<T = unknown> {
  /** Get full state */
  getState(): T;
  /** Get nested value at path */
  getState(path: string[]): unknown;
  /** Set value at path. Empty path = replace root. */
  setState(path: string[], value: unknown): void;
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Dispose store resources */
  dispose?(): void;
}

/**
 * Named store entry for plugin configuration.
 */
export interface StoreEntry {
  name: string;
  adapter: StoreAdapter;
}

/**
 * Options for StorePlugin.init()
 */
export interface StorePluginOptions {
  /** Named stores to register */
  stores?: Record<string, StoreAdapter>;
}
