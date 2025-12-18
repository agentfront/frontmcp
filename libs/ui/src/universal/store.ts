/**
 * FrontMCP Store
 *
 * Simple observable store for managing tool context and state.
 * Uses React 18's useSyncExternalStore for subscription.
 *
 * @example
 * ```typescript
 * // Create store
 * const store = createFrontMCPStore();
 *
 * // Update state
 * store.setState({ toolName: 'get_weather', output: { temp: 72 } });
 *
 * // In React component
 * const state = useFrontMCPStore();
 * console.log(state.output);
 * ```
 */

import { useSyncExternalStore } from 'react';
import type { FrontMCPState, FrontMCPStore, UniversalContent } from './types';
import { DEFAULT_FRONTMCP_STATE } from './types';

// ============================================
// Store Creation
// ============================================

/**
 * Create a new FrontMCP store instance.
 *
 * @param initialState - Initial state values
 * @returns Store instance with subscription support
 */
export function createFrontMCPStore(initialState?: Partial<FrontMCPState>): FrontMCPStore {
  let state: FrontMCPState = {
    ...DEFAULT_FRONTMCP_STATE,
    ...initialState,
  };

  const listeners = new Set<() => void>();

  const getState = (): FrontMCPState => state;

  const getServerState = (): FrontMCPState => state;

  const setState = (partial: Partial<FrontMCPState>): void => {
    // Check if any values actually changed using shallow equality
    const hasChanged = Object.keys(partial).some(
      (key) => partial[key as keyof FrontMCPState] !== state[key as keyof FrontMCPState],
    );

    if (hasChanged) {
      state = { ...state, ...partial };
      listeners.forEach((listener) => listener());
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const reset = (): void => {
    setState({
      ...DEFAULT_FRONTMCP_STATE,
      ...initialState,
    });
  };

  return {
    getState,
    getServerState,
    setState,
    subscribe,
    reset,
  };
}

// ============================================
// Global Store Instance
// ============================================

/**
 * Global store instance for the FrontMCP runtime.
 * Used by the inline runtime builder for browser execution.
 */
let globalStore: FrontMCPStore | null = null;

/**
 * Get or create the global store instance.
 */
export function getGlobalStore(): FrontMCPStore {
  if (!globalStore) {
    globalStore = createFrontMCPStore();
  }
  return globalStore;
}

/**
 * Set the global store instance.
 * Used for testing or custom store injection.
 */
export function setGlobalStore(store: FrontMCPStore): void {
  globalStore = store;
}

/**
 * Reset the global store to a new instance.
 */
export function resetGlobalStore(initialState?: Partial<FrontMCPState>): void {
  globalStore = createFrontMCPStore(initialState);
}

// ============================================
// React Hooks
// ============================================

/**
 * Hook to access the FrontMCP store state.
 *
 * @param store - Optional store instance (uses global if not provided)
 * @returns Current store state
 *
 * @example
 * ```tsx
 * function MyWidget() {
 *   const { output, loading, error } = useFrontMCPStore();
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} />;
 *
 *   return <div>{output?.message}</div>;
 * }
 * ```
 */
export function useFrontMCPStore(store?: FrontMCPStore): FrontMCPState {
  const targetStore = store ?? getGlobalStore();

  return useSyncExternalStore(targetStore.subscribe, targetStore.getState, targetStore.getServerState);
}

/**
 * Hook to access the tool output data.
 *
 * @param store - Optional store instance
 * @returns Tool output (typed as T) or null
 *
 * @example
 * ```tsx
 * interface WeatherData {
 *   temperature: number;
 *   conditions: string;
 * }
 *
 * function Weather() {
 *   const output = useToolOutput<WeatherData>();
 *   return <div>{output?.temperature}°F</div>;
 * }
 * ```
 */
export function useToolOutput<T = unknown>(store?: FrontMCPStore): T | null {
  const state = useFrontMCPStore(store);
  return state.output as T | null;
}

/**
 * Hook to access the tool input arguments.
 *
 * @param store - Optional store instance
 * @returns Tool input or null
 */
export function useToolInput<T extends Record<string, unknown> = Record<string, unknown>>(
  store?: FrontMCPStore,
): T | null {
  const state = useFrontMCPStore(store);
  return state.input as T | null;
}

/**
 * Hook to access the content configuration.
 *
 * @param store - Optional store instance
 * @returns Content configuration or null
 */
export function useContent(store?: FrontMCPStore): UniversalContent | null {
  const state = useFrontMCPStore(store);
  return state.content;
}

/**
 * Hook to access the tool name.
 *
 * @param store - Optional store instance
 * @returns Tool name or null
 */
export function useToolName(store?: FrontMCPStore): string | null {
  const state = useFrontMCPStore(store);
  return state.toolName;
}

/**
 * Hook to access loading and error states.
 *
 * @param store - Optional store instance
 * @returns Loading and error state
 */
export function useLoadingState(store?: FrontMCPStore): { loading: boolean; error: string | null } {
  const state = useFrontMCPStore(store);
  return { loading: state.loading, error: state.error };
}

// ============================================
// Store Utilities
// ============================================

/**
 * Initialize store from window.__frontmcp data.
 * Used by the inline runtime to hydrate the store.
 *
 * @param store - Store instance to initialize
 */
export function initializeStoreFromWindow(store?: FrontMCPStore): void {
  const targetStore = store ?? getGlobalStore();

  // Check for window.__frontmcp data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowData = typeof window !== 'undefined' ? (window as any).__frontmcp : undefined;

  if (windowData?.context) {
    targetStore.setState({
      toolName: windowData.context.toolName ?? null,
      input: windowData.context.toolInput ?? null,
      output: windowData.context.toolOutput ?? null,
      structuredContent: windowData.context.structuredContent ?? null,
      loading: false,
      error: null,
    });
  }
}

/**
 * Create a store selector for derived state.
 *
 * @param selector - Function to select derived state
 * @returns Hook that returns the selected state
 *
 * @example
 * ```tsx
 * const useTemperature = createStoreSelector((state) => state.output?.temperature);
 *
 * function Temperature() {
 *   const temp = useTemperature();
 *   return <div>{temp}°F</div>;
 * }
 * ```
 */
export function createStoreSelector<T>(selector: (state: FrontMCPState) => T): (store?: FrontMCPStore) => T {
  return (store?: FrontMCPStore) => {
    const state = useFrontMCPStore(store);
    return selector(state);
  };
}
