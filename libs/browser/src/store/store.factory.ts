// file: libs/browser/src/store/store.factory.ts
/**
 * Factory for creating MCP stores with Valtio.
 *
 * Provides reactive state management with subscription and mutation tracking.
 */

import { proxy, snapshot, subscribe, ref } from 'valtio';
import { subscribeKey as valtioSubscribeKey } from 'valtio/utils';
import type {
  McpStore,
  McpStoreOptions,
  StateChangeListener,
  KeyChangeListener,
  MutationListener,
  MutationOperation,
} from './store.types';

/**
 * Default storage key prefix for persisted stores.
 */
const DEFAULT_STORAGE_KEY = 'mcp-store';

/**
 * Create an MCP store with Valtio reactive state management.
 *
 * @template T - The state object type
 * @param options - Store configuration options
 * @returns An MCP store instance
 *
 * @example Basic usage
 * ```typescript
 * interface AppState {
 *   count: number;
 *   user: { name: string } | null;
 * }
 *
 * const store = createMcpStore<AppState>({
 *   initialState: {
 *     count: 0,
 *     user: null,
 *   },
 * });
 *
 * // Read state
 * console.log(store.state.count);
 *
 * // Mutate state
 * store.state.count++;
 * store.state.user = { name: 'John' };
 *
 * // Subscribe to changes
 * store.subscribe((state) => console.log('Changed:', state));
 * ```
 *
 * @example With persistence
 * ```typescript
 * const store = createMcpStore({
 *   initialState: { count: 0 },
 *   persist: 'my-app-state',
 * });
 * ```
 */
export function createMcpStore<T extends object>(options: McpStoreOptions<T>): McpStore<T> {
  const { initialState, devMode = false, name, persist, storage } = options;

  // Deep clone initial state to preserve original (for reset functionality)
  // We need TWO clones: one for reset reference, one for the proxy
  const savedInitialState = JSON.parse(JSON.stringify(initialState)) as T;

  // Load persisted state if enabled
  let loadedState = JSON.parse(JSON.stringify(initialState)) as T;
  if (persist) {
    const persistedState = loadPersistedState<T>(persist, storage);
    if (persistedState) {
      loadedState = { ...loadedState, ...persistedState };
    }
  }

  // Create Valtio proxy (this wraps loadedState, which may be mutated)
  const state = proxy(loadedState);

  // Mutation listeners
  const mutationListeners = new Set<MutationListener>();

  // Track mutations
  let isBatching = false;
  let batchedOps: MutationOperation[] = [];

  // Subscribe for persistence
  if (persist) {
    subscribe(state, () => {
      persistState(snapshot(state) as T, persist, storage);
    });
  }

  // Dev mode logging
  if (devMode) {
    subscribe(state, () => {
      console.log(`[MCP Store${name ? ` - ${name}` : ''}]`, snapshot(state));
    });
  }

  const store: McpStore<T> = {
    get state() {
      return state;
    },

    getSnapshot(): Readonly<T> {
      return snapshot(state) as Readonly<T>;
    },

    subscribe(listener: StateChangeListener<T>): () => void {
      let previousSnapshot = snapshot(state) as T;

      const unsubscribe = subscribe(state, () => {
        const currentSnapshot = snapshot(state) as T;
        try {
          listener(currentSnapshot, previousSnapshot);
        } finally {
          previousSnapshot = currentSnapshot;
        }
      });

      return unsubscribe;
    },

    subscribeKey<K extends keyof T>(key: K, listener: KeyChangeListener<T[K]>): () => void {
      return valtioSubscribeKey(state, key, (value: T[K]) => {
        // For key subscription, we don't track previous value
        // as Valtio's subscribeKey doesn't provide it
        listener(value, value);
      });
    },

    onMutation(listener: MutationListener): () => void {
      mutationListeners.add(listener);
      return () => {
        mutationListeners.delete(listener);
      };
    },

    reset(newInitialState?: Partial<T>): void {
      const resetState = newInitialState ? { ...savedInitialState, ...newInitialState } : savedInitialState;

      // Reset each key
      for (const key of Object.keys(resetState) as (keyof T)[]) {
        (state as T)[key] = JSON.parse(JSON.stringify(resetState[key]));
      }

      // Clear keys that aren't in reset state
      for (const key of Object.keys(state) as (keyof T)[]) {
        if (!(key in resetState)) {
          delete (state as T)[key];
        }
      }
    },

    batch(fn: (state: T) => void): void {
      isBatching = true;
      batchedOps = [];

      try {
        fn(state);
      } finally {
        isBatching = false;

        // Notify mutation listeners with batched operations
        if (batchedOps.length > 0) {
          for (const listener of mutationListeners) {
            try {
              listener(batchedOps);
            } catch (error) {
              if (devMode) {
                console.error('[MCP Store] Mutation listener error:', error);
              }
            }
          }
        }
        batchedOps = [];
      }
    },
  };

  return store;
}

/**
 * Load state from storage.
 */
function loadPersistedState<T>(persist: boolean | string, storage?: Storage): T | null {
  try {
    const storageImpl = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storageImpl) {
      return null;
    }

    const key = typeof persist === 'string' ? persist : DEFAULT_STORAGE_KEY;
    const stored = storageImpl.getItem(key);

    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

/**
 * Persist state to storage.
 */
function persistState<T>(state: T, persist: boolean | string, storage?: Storage): void {
  try {
    const storageImpl = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storageImpl) {
      return;
    }

    const key = typeof persist === 'string' ? persist : DEFAULT_STORAGE_KEY;
    storageImpl.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Create a store action helper.
 *
 * Actions are bound functions that operate on the store state.
 *
 * @example
 * ```typescript
 * const store = createMcpStore({ initialState: { count: 0 } });
 *
 * const increment = createAction(store, (state) => {
 *   state.count++;
 * });
 *
 * increment();
 * ```
 */
export function createAction<T extends object, Args extends unknown[]>(
  store: McpStore<T>,
  action: (state: T, ...args: Args) => void,
): (...args: Args) => void {
  return (...args: Args) => {
    action(store.state, ...args);
  };
}

/**
 * Create an async store action helper.
 *
 * @example
 * ```typescript
 * const fetchUser = createAsyncAction(store, async (state, userId: string) => {
 *   state.loading = true;
 *   try {
 *     const user = await api.getUser(userId);
 *     state.user = user;
 *   } finally {
 *     state.loading = false;
 *   }
 * });
 *
 * await fetchUser('123');
 * ```
 */
export function createAsyncAction<T extends object, Args extends unknown[], R>(
  store: McpStore<T>,
  action: (state: T, ...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return (...args: Args) => {
    return action(store.state, ...args);
  };
}

/**
 * Create a computed value that derives from store state.
 *
 * @example
 * ```typescript
 * const store = createMcpStore({
 *   initialState: { items: [1, 2, 3] },
 * });
 *
 * const total = createComputed(store, (state) => {
 *   return state.items.reduce((sum, item) => sum + item, 0);
 * });
 *
 * console.log(total()); // 6
 * ```
 */
export function createComputed<T extends object, R>(store: McpStore<T>, compute: (state: Readonly<T>) => R): () => R {
  return () => compute(store.getSnapshot());
}

/**
 * Create a selector function for extracting state subsets.
 *
 * @example
 * ```typescript
 * const store = createMcpStore({
 *   initialState: { user: { name: 'John', age: 30 } },
 * });
 *
 * const selectUserName = createSelector(store, (state) => state.user.name);
 *
 * console.log(selectUserName()); // 'John'
 * ```
 */
export function createSelector<T extends object, R>(store: McpStore<T>, selector: (state: Readonly<T>) => R): () => R {
  return () => selector(store.getSnapshot());
}
