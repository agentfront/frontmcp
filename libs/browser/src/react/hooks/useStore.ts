// file: libs/browser/src/react/hooks/useStore.ts
/**
 * Hook for accessing the reactive Valtio store.
 *
 * @example
 * ```tsx
 * import { useStore } from '@frontmcp/browser/react';
 *
 * interface AppState {
 *   count: number;
 *   user: { name: string };
 * }
 *
 * function Counter() {
 *   const { state, set, get } = useStore<AppState>();
 *
 *   return (
 *     <div>
 *       <p>Count: {state.count}</p>
 *       <button onClick={() => set('count', state.count + 1)}>
 *         Increment
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useSyncExternalStore, useCallback } from 'react';
import { useFrontMcpContext, type BrowserStore } from '../context';

/**
 * Return type for useStore hook.
 */
export interface UseStoreResult<TState extends object> {
  /**
   * Current state snapshot (read-only, triggers re-renders).
   */
  state: TState;

  /**
   * Direct store reference for mutations.
   */
  store: BrowserStore<TState> | null;

  /**
   * Helper to set a value by key.
   */
  set: <K extends keyof TState>(key: K, value: TState[K]) => void;

  /**
   * Helper to get a value by key.
   */
  get: <K extends keyof TState>(key: K) => TState[K];

  /**
   * Whether the store is available.
   */
  isAvailable: boolean;
}

/**
 * Hook to access the reactive store with Valtio.
 *
 * @template TState - The state type
 * @returns Store access utilities
 */
export function useStore<TState extends object = object>(): UseStoreResult<TState> {
  const { store } = useFrontMcpContext<TState>();

  // Use React 18's useSyncExternalStore for proper subscription
  const state = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        if (!store) {
          return () => {};
        }
        return store.subscribe(onStoreChange);
      },
      [store],
    ),
    useCallback(() => {
      if (!store) {
        return {} as TState;
      }
      return store.getSnapshot();
    }, [store]),
    // Server snapshot (same as client for now)
    useCallback(() => {
      if (!store) {
        return {} as TState;
      }
      return store.getSnapshot();
    }, [store]),
  );

  // Set helper
  const set = useCallback(
    <K extends keyof TState>(key: K, value: TState[K]): void => {
      if (store) {
        store.state[key] = value;
      }
    },
    [store],
  );

  // Get helper
  const get = useCallback(
    <K extends keyof TState>(key: K): TState[K] => {
      if (!store) {
        throw new Error('Store not available');
      }
      return store.getSnapshot()[key];
    },
    [store],
  );

  return {
    state,
    store: store as BrowserStore<TState> | null,
    set,
    get,
    isAvailable: store !== null,
  };
}

/**
 * Hook to subscribe to a specific key in the store.
 *
 * @template TState - The state type
 * @template K - The key type
 * @param key - The key to subscribe to
 * @returns The current value of the key
 *
 * @example
 * ```tsx
 * function UserName() {
 *   const name = useStoreKey<AppState, 'user'>('user').name;
 *   return <p>Hello, {name}</p>;
 * }
 * ```
 */
export function useStoreKey<TState extends object, K extends keyof TState>(key: K): TState[K] {
  const { store } = useFrontMcpContext<TState>();

  return useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        if (!store) {
          return () => {};
        }
        return store.subscribeKey(key, onStoreChange);
      },
      [store, key],
    ),
    useCallback(() => {
      if (!store) {
        return undefined as TState[K];
      }
      return store.getSnapshot()[key];
    }, [store, key]),
    useCallback(() => {
      if (!store) {
        return undefined as TState[K];
      }
      return store.getSnapshot()[key];
    }, [store, key]),
  );
}
