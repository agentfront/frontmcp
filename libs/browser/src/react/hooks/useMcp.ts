// file: libs/browser/src/react/hooks/useMcp.ts
/**
 * Hook for full MCP context access.
 *
 * @example
 * ```tsx
 * import { useMcp } from '@frontmcp/browser/react';
 *
 * function McpDebugger() {
 *   const {
 *     scope,  // Preferred: SDK-based scope
 *     server, // Deprecated: legacy server
 *     store,
 *     transport,
 *     isConnected,
 *     callTool,
 *     readResource,
 *     listTools,
 *     listResources,
 *   } = useMcp();
 *
 *   return (
 *     <div>
 *       <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
 *       <p>Tools: {listTools().length}</p>
 *       <p>Resources: {listResources().length}</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useFrontMcpContext } from '../context';
import type { FrontMcpContextValue } from '../context';

/**
 * Return type for useMcp hook.
 */
export interface UseMcpResult<TState extends object = object>
  extends Omit<
    FrontMcpContextValue<TState>,
    | 'pageElements'
    | 'registerPageElement'
    | 'unregisterPageElement'
    | 'pendingElicitRequest'
    | 'respondToElicit'
    | 'dismissElicit'
  > {
  /**
   * Whether the MCP server is ready for use.
   */
  isReady: boolean;
}

/**
 * Hook for full MCP context access.
 *
 * This is a convenience hook that provides access to the full MCP context
 * without the page element and elicit-specific functionality.
 *
 * @template TState - The store state type
 * @returns MCP context utilities
 */
export function useMcp<TState extends object = object>(): UseMcpResult<TState> {
  const {
    server,
    scope,
    store,
    transport,
    componentRegistry,
    rendererRegistry,
    isConnected,
    isConnecting,
    error,
    notifyAgent,
    callTool,
    readResource,
    listTools,
    listResources,
  } = useFrontMcpContext<TState>();

  return {
    server,
    scope,
    store,
    transport,
    componentRegistry,
    rendererRegistry,
    isConnected,
    isConnecting,
    error,
    notifyAgent,
    callTool,
    readResource,
    listTools,
    listResources,
    // Ready when connected and have either scope or server
    isReady: isConnected && (scope !== null || server !== null),
  };
}

/**
 * Hook to check if the MCP context is available.
 *
 * Unlike other hooks, this won't throw if used outside of FrontMcpProvider.
 *
 * @returns Whether the MCP context is available
 */
export function useMcpAvailable(): boolean {
  try {
    const { server, scope, isConnected } = useFrontMcpContext();
    return (scope !== null || server !== null) && isConnected;
  } catch {
    return false;
  }
}

/**
 * Hook to get the connection status.
 *
 * @returns Connection status information
 */
export function useMcpStatus(): {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
} {
  const { isConnected, isConnecting, error } = useFrontMcpContext();
  return { isConnected, isConnecting, error };
}
