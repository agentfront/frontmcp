// file: libs/browser/src/store/store.types.ts
/**
 * Valtio-based store types for browser MCP server.
 *
 * These types define the reactive state management layer using Valtio
 * for browser-native MCP servers.
 */

/**
 * Mutation operation types for store changes.
 */
export type MutationOperation =
  | { type: 'set'; path: string[]; value: unknown; previousValue: unknown }
  | { type: 'delete'; path: string[]; previousValue: unknown }
  | { type: 'insert'; path: string[]; index: number; value: unknown }
  | { type: 'remove'; path: string[]; index: number; previousValue: unknown };

/**
 * Listener for state changes.
 */
export type StateChangeListener<T> = (state: T, previousState: T) => void;

/**
 * Listener for key-specific changes.
 */
export type KeyChangeListener<T> = (value: T, previousValue: T) => void;

/**
 * Listener for mutations.
 */
export type MutationListener = (ops: MutationOperation[]) => void;

/**
 * McpStore interface for reactive state management.
 *
 * This wraps Valtio's proxy with additional methods for MCP integration.
 *
 * @template T - The state object type
 *
 * @example
 * ```typescript
 * interface AppState {
 *   count: number;
 *   items: string[];
 *   config: { theme: 'light' | 'dark' };
 * }
 *
 * const store = createMcpStore<AppState>({
 *   count: 0,
 *   items: [],
 *   config: { theme: 'light' },
 * });
 *
 * // Read state
 * console.log(store.state.count);
 *
 * // Mutate state (triggers reactivity)
 * store.state.count++;
 * store.state.items.push('new item');
 *
 * // Get immutable snapshot
 * const snapshot = store.getSnapshot();
 *
 * // Subscribe to changes
 * const unsubscribe = store.subscribe((state) => {
 *   console.log('State changed:', state);
 * });
 * ```
 */
export interface McpStore<T extends object> {
  /**
   * The reactive state proxy.
   *
   * Mutating this object will trigger subscriptions and reactivity.
   * This is the Valtio proxy object.
   */
  readonly state: T;

  /**
   * Get an immutable snapshot of the current state.
   *
   * Use this for reading state without triggering reactivity
   * or for safe passing to async operations.
   *
   * @returns Immutable snapshot of current state
   */
  getSnapshot(): Readonly<T>;

  /**
   * Subscribe to all state changes.
   *
   * The callback is invoked whenever any part of the state changes.
   *
   * @param listener - Callback invoked on state change
   * @returns Unsubscribe function
   */
  subscribe(listener: StateChangeListener<T>): () => void;

  /**
   * Subscribe to changes in a specific key.
   *
   * More efficient than full subscribe when only interested in specific values.
   *
   * @template K - The key type
   * @param key - The state key to watch
   * @param listener - Callback invoked when key value changes
   * @returns Unsubscribe function
   */
  subscribeKey<K extends keyof T>(key: K, listener: KeyChangeListener<T[K]>): () => void;

  /**
   * Subscribe to mutation operations.
   *
   * Lower-level access to individual mutations for advanced use cases
   * like undo/redo, sync, or debugging.
   *
   * @param listener - Callback invoked with mutation operations
   * @returns Unsubscribe function
   */
  onMutation(listener: MutationListener): () => void;

  /**
   * Reset state to initial values.
   *
   * @param initialState - Optional new initial state
   */
  reset(initialState?: Partial<T>): void;

  /**
   * Batch multiple mutations into a single update.
   *
   * Subscribers are only notified once after all mutations complete.
   *
   * @param fn - Function that performs mutations
   */
  batch(fn: (state: T) => void): void;
}

/**
 * Options for creating an MCP store.
 */
export interface McpStoreOptions<T extends object> {
  /**
   * Initial state values.
   */
  initialState: T;

  /**
   * Enable development mode features (logging, devtools).
   * Default: false
   */
  devMode?: boolean;

  /**
   * Store name for devtools.
   */
  name?: string;

  /**
   * Persist state to storage.
   * If true, uses localStorage with default key.
   * If string, uses that as the storage key.
   */
  persist?: boolean | string;

  /**
   * Custom storage implementation.
   * Default: localStorage
   */
  storage?: Storage;
}

/**
 * Computed value definition for derived state.
 */
export interface ComputedValue<T, R> {
  /**
   * Compute function that derives value from state.
   */
  compute: (state: T) => R;

  /**
   * Dependencies that trigger recomputation.
   * If not specified, all state changes trigger recomputation.
   */
  dependencies?: (keyof T)[];
}

/**
 * Store with computed values.
 */
export interface McpStoreWithComputed<T extends object, C extends Record<string, unknown>> extends McpStore<T> {
  /**
   * Computed values derived from state.
   */
  readonly computed: Readonly<C>;
}

/**
 * Factory function type for creating MCP stores.
 */
export type CreateMcpStore = <T extends object>(options: McpStoreOptions<T>) => McpStore<T>;

/**
 * Store actions definition.
 *
 * Actions are functions that operate on the store state.
 */
export type StoreActions<T extends object> = {
  [key: string]: (state: T, ...args: unknown[]) => void | Promise<void>;
};

/**
 * Store with actions.
 */
export interface McpStoreWithActions<T extends object, A extends StoreActions<T>> extends McpStore<T> {
  /**
   * Bound action functions.
   */
  readonly actions: {
    [K in keyof A]: A[K] extends (state: T, ...args: infer P) => infer R ? (...args: P) => R : never;
  };
}
