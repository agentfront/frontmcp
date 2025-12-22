/**
 * @file context.tsx
 * @description React context for FrontMcpBridge.
 *
 * Provides a context provider that initializes and exposes the MCP bridge
 * to all child components via hooks.
 *
 * @example
 * ```tsx
 * import { McpBridgeProvider, useMcpBridge } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <McpBridgeProvider>
 *       <MyComponent />
 *     </McpBridgeProvider>
 *   );
 * }
 * ```
 *
 * @module @frontmcp/ui/react/hooks
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type {
  FrontMcpBridgeInterface,
  BridgeConfig,
  AdapterCapabilities,
  HostContext,
  DisplayMode,
} from '../../bridge';
import { FrontMcpBridge } from '../../bridge';

// ============================================
// Types
// ============================================

/**
 * MCP Bridge context value.
 */
export interface McpBridgeContextValue {
  /** The bridge instance (null until initialized) */
  bridge: FrontMcpBridgeInterface | null;
  /** Whether the bridge is currently initializing */
  loading: boolean;
  /** Initialization error, if any */
  error: Error | null;
  /** Whether the bridge is initialized and ready */
  ready: boolean;
  /** Current adapter ID */
  adapterId: string | undefined;
  /** Current adapter capabilities */
  capabilities: AdapterCapabilities | undefined;
}

/**
 * Props for McpBridgeProvider.
 */
export interface McpBridgeProviderProps {
  /** Child components */
  children: ReactNode;
  /** Bridge configuration */
  config?: BridgeConfig;
  /** Callback when bridge is ready */
  onReady?: (bridge: FrontMcpBridgeInterface) => void;
  /** Callback when bridge initialization fails */
  onError?: (error: Error) => void;
}

// ============================================
// Context
// ============================================

const McpBridgeContext = createContext<McpBridgeContextValue | null>(null);

/**
 * Provider component that initializes the MCP bridge.
 *
 * @example Basic usage
 * ```tsx
 * <McpBridgeProvider>
 *   <App />
 * </McpBridgeProvider>
 * ```
 *
 * @example With configuration
 * ```tsx
 * <McpBridgeProvider
 *   config={{ debug: true, forceAdapter: 'generic' }}
 *   onReady={(bridge) => console.log('Bridge ready:', bridge.adapterId)}
 *   onError={(err) => console.error('Bridge error:', err)}
 * >
 *   <App />
 * </McpBridgeProvider>
 * ```
 */
export function McpBridgeProvider({ children, config, onReady, onError }: McpBridgeProviderProps) {
  const [bridge, setBridge] = useState<FrontMcpBridgeInterface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    let bridgeInstance: FrontMcpBridge | null = null;

    const initBridge = async () => {
      try {
        bridgeInstance = new FrontMcpBridge(config);
        await bridgeInstance.initialize();

        if (mounted) {
          setBridge(bridgeInstance);
          setLoading(false);
          onReady?.(bridgeInstance);
        }
      } catch (err) {
        if (mounted) {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setLoading(false);
          onError?.(error);
        }
      }
    };

    initBridge();

    return () => {
      mounted = false;
      if (bridgeInstance) {
        bridgeInstance.dispose();
      }
    };
  }, [config, onReady, onError]);

  const contextValue = useMemo<McpBridgeContextValue>(
    () => ({
      bridge,
      loading,
      error,
      ready: !loading && !error && bridge !== null,
      adapterId: bridge?.adapterId,
      capabilities: bridge?.capabilities,
    }),
    [bridge, loading, error],
  );

  return <McpBridgeContext.Provider value={contextValue}>{children}</McpBridgeContext.Provider>;
}

// ============================================
// Hooks
// ============================================

/**
 * Default context value for SSR.
 * When the component is rendered outside of McpBridgeProvider (e.g., during SSR),
 * this value is returned instead of throwing an error.
 */
const SSR_DEFAULT_CONTEXT: McpBridgeContextValue = {
  bridge: null,
  loading: false,
  error: null,
  ready: false,
  adapterId: undefined,
  capabilities: undefined,
};

/**
 * Hook to access the MCP bridge context.
 *
 * During client-side rendering, must be used within a McpBridgeProvider.
 * During SSR (outside of provider), returns a default "not ready" state.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { bridge, loading, error, ready } = useMcpBridgeContext();
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!ready) return null;
 *
 *   return <div>Adapter: {bridge.adapterId}</div>;
 * }
 * ```
 */
export function useMcpBridgeContext(): McpBridgeContextValue {
  const context = useContext(McpBridgeContext);

  // During SSR or outside of provider, return default context instead of throwing
  if (!context) {
    return SSR_DEFAULT_CONTEXT;
  }

  return context;
}

/**
 * Hook to get the MCP bridge instance.
 * Returns null while loading or if not initialized.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const bridge = useMcpBridge();
 *
 *   if (!bridge) return <div>Loading...</div>;
 *
 *   const theme = bridge.getTheme();
 *   const input = bridge.getToolInput();
 *
 *   return <div>Theme: {theme}</div>;
 * }
 * ```
 */
export function useMcpBridge(): FrontMcpBridgeInterface | null {
  const { bridge } = useMcpBridgeContext();
  return bridge;
}

/**
 * Hook to get the current theme from the bridge.
 * Automatically updates when theme changes.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const theme = useTheme();
 *   return <div className={theme === 'dark' ? 'bg-black' : 'bg-white'}>...</div>;
 * }
 * ```
 */
export function useTheme(): 'light' | 'dark' {
  const { bridge, ready } = useMcpBridgeContext();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (!ready || !bridge) return;

    // Get initial theme
    setTheme(bridge.getTheme());

    // Subscribe to changes
    const unsubscribe = bridge.onContextChange((changes) => {
      if (changes.theme) {
        setTheme(changes.theme);
      }
    });

    return unsubscribe;
  }, [bridge, ready]);

  return theme;
}

/**
 * Hook to get the current display mode from the bridge.
 * Automatically updates when display mode changes.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const displayMode = useDisplayMode();
 *   return <div>Mode: {displayMode}</div>;
 * }
 * ```
 */
export function useDisplayMode(): DisplayMode {
  const { bridge, ready } = useMcpBridgeContext();
  const [displayMode, setDisplayMode] = useState<DisplayMode>('inline');

  useEffect(() => {
    if (!ready || !bridge) return;

    // Get initial display mode
    setDisplayMode(bridge.getDisplayMode());

    // Subscribe to changes
    const unsubscribe = bridge.onContextChange((changes) => {
      if (changes.displayMode) {
        setDisplayMode(changes.displayMode);
      }
    });

    return unsubscribe;
  }, [bridge, ready]);

  return displayMode;
}

/**
 * Hook to get the full host context from the bridge.
 * Automatically updates when context changes.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const context = useHostContext();
 *   return (
 *     <div>
 *       Theme: {context?.theme}
 *       Locale: {context?.locale}
 *     </div>
 *   );
 * }
 * ```
 */
export function useHostContext(): HostContext | null {
  const { bridge, ready } = useMcpBridgeContext();
  const [context, setContext] = useState<HostContext | null>(null);

  useEffect(() => {
    if (!ready || !bridge) return;

    // Get initial context
    const adapter = bridge.getAdapter?.();
    if (adapter) {
      setContext(adapter.getHostContext());
    }

    // Subscribe to changes
    const unsubscribe = bridge.onContextChange((changes) => {
      setContext((prev) => (prev ? { ...prev, ...changes } : null));
    });

    return unsubscribe;
  }, [bridge, ready]);

  return context;
}

/**
 * Hook to check if the bridge has a specific capability.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const canCallTools = useCapability('canCallTools');
 *   const canSendMessages = useCapability('canSendMessages');
 *
 *   return (
 *     <div>
 *       {canCallTools && <button>Call Tool</button>}
 *       {canSendMessages && <button>Send Message</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCapability(cap: keyof AdapterCapabilities): boolean {
  const { capabilities } = useMcpBridgeContext();
  return capabilities?.[cap] === true;
}
