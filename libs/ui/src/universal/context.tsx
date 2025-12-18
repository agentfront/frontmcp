/**
 * FrontMCP Context Provider
 *
 * React context for providing the FrontMCP store to child components.
 * Supports custom store injection and auto-initialization from window.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { FrontMCPStore, FrontMCPProviderProps, FrontMCPState } from './types';
import { createFrontMCPStore, initializeStoreFromWindow } from './store';

// ============================================
// Context
// ============================================

/**
 * Context for the FrontMCP store.
 */
const FrontMCPContext = createContext<FrontMCPStore | null>(null);

/**
 * Context for custom components available in renderers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ComponentsContext = createContext<Record<string, React.ComponentType<any>>>({});

// ============================================
// Provider Component
// ============================================

/**
 * FrontMCP Provider component.
 *
 * Provides the FrontMCP store to child components and optionally
 * initializes from window.__frontmcp data.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <FrontMCPProvider>
 *       <MyWidget />
 *     </FrontMCPProvider>
 *   );
 * }
 * ```
 *
 * @example Custom store
 * ```tsx
 * const store = createFrontMCPStore({ toolName: 'test' });
 *
 * function App() {
 *   return (
 *     <FrontMCPProvider store={store}>
 *       <MyWidget />
 *     </FrontMCPProvider>
 *   );
 * }
 * ```
 */
export function FrontMCPProvider({ store, initialState, children }: FrontMCPProviderProps): React.ReactElement {
  // Create or use provided store
  const storeRef = useRef<FrontMCPStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = store ?? createFrontMCPStore(initialState);
  }

  const actualStore = storeRef.current;

  // Initialize from window on mount (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined' && !store) {
      initializeStoreFromWindow(actualStore);
    }
  }, [actualStore, store]);

  return <FrontMCPContext.Provider value={actualStore}>{children}</FrontMCPContext.Provider>;
}

// ============================================
// Components Provider
// ============================================

/**
 * Props for the ComponentsProvider.
 */
export interface ComponentsProviderProps {
  /** Custom components to make available */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: Record<string, React.ComponentType<any>>;
  /** Children to render (optional when using React.createElement) */
  children?: React.ReactNode;
}

/**
 * Provide custom components to renderers.
 *
 * @example
 * ```tsx
 * const components = {
 *   WeatherCard: ({ temp }) => <div>{temp}°F</div>,
 *   Badge: ({ type }) => <span className={type}>Badge</span>,
 * };
 *
 * function App() {
 *   return (
 *     <ComponentsProvider components={components}>
 *       <UniversalRenderer content={mdxContent} />
 *     </ComponentsProvider>
 *   );
 * }
 * ```
 */
export function ComponentsProvider({ components, children }: ComponentsProviderProps): React.ReactElement {
  // Merge with parent components
  const parentComponents = useContext(ComponentsContext);
  const mergedComponents = useMemo(
    () => ({
      ...parentComponents,
      ...components,
    }),
    [parentComponents, components],
  );

  return <ComponentsContext.Provider value={mergedComponents}>{children}</ComponentsContext.Provider>;
}

// ============================================
// Hooks
// ============================================

/**
 * Hook to access the FrontMCP store from context.
 *
 * @throws Error if used outside of FrontMCPProvider
 * @returns Store instance
 */
export function useFrontMCPContext(): FrontMCPStore {
  const store = useContext(FrontMCPContext);

  if (!store) {
    throw new Error('useFrontMCPContext must be used within a FrontMCPProvider');
  }

  return store;
}

/**
 * Hook to access custom components from context.
 *
 * @returns Components record
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useComponents(): Record<string, React.ComponentType<any>> {
  return useContext(ComponentsContext);
}

/**
 * Hook to safely access the FrontMCP store (returns null outside provider).
 *
 * @returns Store instance or null
 */
export function useFrontMCPContextSafe(): FrontMCPStore | null {
  return useContext(FrontMCPContext);
}

// ============================================
// Combined Provider
// ============================================

/**
 * Props for the combined UniversalProvider.
 */
export interface UniversalProviderProps extends FrontMCPProviderProps {
  /** Custom components to make available */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, React.ComponentType<any>>;
}

/**
 * Combined provider for FrontMCP store and custom components.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <UniversalProvider
 *       initialState={{ toolName: 'get_weather' }}
 *       components={{ WeatherCard: MyWeatherCard }}
 *     >
 *       <UniversalApp />
 *     </UniversalProvider>
 *   );
 * }
 * ```
 */
export function UniversalProvider({
  store,
  initialState,
  components = {},
  children,
}: UniversalProviderProps): React.ReactElement {
  return (
    <FrontMCPProvider store={store} initialState={initialState}>
      <ComponentsProvider components={components}>{children}</ComponentsProvider>
    </FrontMCPProvider>
  );
}

// ============================================
// HOC
// ============================================

/**
 * Higher-order component to inject FrontMCP store as props.
 *
 * @param Component - Component to wrap
 * @returns Wrapped component with store props
 */
export function withFrontMCP<P extends { state?: FrontMCPState }>(
  Component: React.ComponentType<P>,
): React.FC<Omit<P, 'state'>> {
  const WrappedComponent: React.FC<Omit<P, 'state'>> = (props) => {
    const store = useFrontMCPContext();
    const state = store.getState();
    return <Component {...(props as P)} state={state} />;
  };

  WrappedComponent.displayName = `withFrontMCP(${Component.displayName || Component.name || 'Component'})`;

  return WrappedComponent;
}
