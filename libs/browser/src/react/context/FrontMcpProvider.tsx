// file: libs/browser/src/react/context/FrontMcpProvider.tsx
/**
 * FrontMCP Provider component for React applications.
 *
 * Provides MCP server, store, and registry access to child components.
 * Similar to React Router, you can use it with or without a server prop.
 *
 * @example Simple usage (server created internally)
 * ```tsx
 * import { FrontMcpProvider } from '@frontmcp/browser/react';
 *
 * function App() {
 *   return (
 *     <FrontMcpProvider>
 *       <MyComponent />
 *     </FrontMcpProvider>
 *   );
 * }
 * ```
 *
 * @example With custom server
 * ```tsx
 * import { FrontMcpProvider } from '@frontmcp/browser/react';
 * import { BrowserMcpServer } from '@frontmcp/browser';
 *
 * const server = new BrowserMcpServer({ name: 'my-app' });
 * server.addTool({ ... });
 *
 * function App() {
 *   return (
 *     <FrontMcpProvider server={server}>
 *       <MyComponent />
 *     </FrontMcpProvider>
 *   );
 * }
 * ```
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { FrontMcpContext, type BrowserStore } from './context';
import type { FrontMcpContextValue, PageElement, ElicitRequest, NotificationEvent } from './context';
import { BrowserMcpServer } from '../../server';
import type { BrowserScope } from '../../scope';
import type { ComponentRegistry, RendererRegistry } from '../../registry';
import type { BrowserTransport } from '../../transport';

/**
 * Props for FrontMcpProvider.
 */
export interface FrontMcpProviderProps<TState extends object = object> {
  /**
   * The browser MCP server instance.
   * If not provided, a default server is created with name 'frontmcp-app'.
   * @deprecated Use `scope` instead for SDK-based integration.
   */
  server?: BrowserMcpServer;

  /**
   * The browser scope instance (SDK-based).
   * When provided, uses scope methods instead of server methods.
   * This provides access to SDK hooks, plugins, and DI.
   */
  scope?: BrowserScope;

  /**
   * Server name (only used when server is not provided).
   * @default 'frontmcp-app'
   */
  name?: string;

  /**
   * Optional reactive store.
   */
  store?: BrowserStore<TState>;

  /**
   * Optional transport adapter.
   */
  transport?: BrowserTransport;

  /**
   * Optional component registry.
   */
  componentRegistry?: ComponentRegistry;

  /**
   * Optional renderer registry.
   */
  rendererRegistry?: RendererRegistry;

  /**
   * Enable page context resource (page://current).
   * @default true
   */
  pageContextEnabled?: boolean;

  /**
   * Enable elicit/HITL functionality.
   * @default true
   */
  elicitEnabled?: boolean;

  /**
   * Auto-start the server on mount.
   * @default true
   */
  autoStart?: boolean;

  /**
   * Callback when agent notification is sent.
   */
  onNotification?: (event: NotificationEvent) => void;

  /**
   * Child components.
   */
  children: ReactNode;
}

/**
 * Generate a unique ID for page elements.
 */
function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * FrontMCP Provider component.
 */
export function FrontMcpProvider<TState extends object = object>({
  server: serverProp,
  scope: scopeProp,
  name = 'frontmcp-app',
  store,
  transport,
  componentRegistry,
  rendererRegistry,
  pageContextEnabled = true,
  elicitEnabled = true,
  autoStart = true,
  onNotification,
  children,
}: FrontMcpProviderProps<TState>): React.ReactElement {
  // Use scope if provided
  const scope = scopeProp ?? null;

  // Create server if not provided (memoized to create only once)
  // Only create server if scope is not provided
  const server = useMemo(() => {
    if (scope) {
      // When scope is provided, don't create a server
      return null;
    }
    if (serverProp) {
      return serverProp;
    }
    // Create a default server
    return new BrowserMcpServer({
      name,
      transport,
      store: store as unknown as undefined,
      componentRegistry,
      rendererRegistry,
    });
  }, [scope, serverProp, name, transport, store, componentRegistry, rendererRegistry]);

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Page elements for AI discovery
  const [pageElements, setPageElements] = useState<Map<string, PageElement>>(new Map());

  // Elicit state
  const [pendingElicitRequest, setPendingElicitRequest] = useState<ElicitRequest | null>(null);
  const elicitResolverRef = useRef<((response: unknown) => void) | null>(null);

  // Register a page element
  const registerPageElement = useCallback((element: Omit<PageElement, 'id'>): string => {
    const id = generateId();
    const fullElement: PageElement = { ...element, id };
    setPageElements((prev) => {
      const next = new Map(prev);
      next.set(id, fullElement);
      return next;
    });
    return id;
  }, []);

  // Unregister a page element
  const unregisterPageElement = useCallback((id: string): void => {
    setPageElements((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Send notification to agent
  const notifyAgent = useCallback(
    (type: string, data: unknown): void => {
      const event: NotificationEvent = {
        type,
        data,
        timestamp: Date.now(),
      };

      // Call user callback
      onNotification?.(event);

      // If transport is available, send via transport
      if (transport) {
        transport.send({
          jsonrpc: '2.0',
          method: 'notifications/event',
          params: event,
        });
      }
    },
    [transport, onNotification],
  );

  // Respond to elicit request
  const respondToElicit = useCallback((response: unknown): void => {
    if (elicitResolverRef.current) {
      elicitResolverRef.current(response);
      elicitResolverRef.current = null;
    }
    setPendingElicitRequest(null);
  }, []);

  // Dismiss elicit request
  const dismissElicit = useCallback((): void => {
    if (elicitResolverRef.current) {
      elicitResolverRef.current({ dismissed: true });
      elicitResolverRef.current = null;
    }
    setPendingElicitRequest(null);
  }, []);

  // Call a tool
  const callTool = useCallback(
    async <TInput = unknown, TOutput = unknown>(name: string, args: TInput): Promise<TOutput> => {
      // Try scope first, then server
      if (scope) {
        const result = await scope.executeTool(name, args);
        return result as TOutput;
      }
      if (server) {
        const result = await server.callTool(name, args as Record<string, unknown>);
        return result as TOutput;
      }
      throw new Error('No server or scope available');
    },
    [scope, server],
  );

  // Read a resource
  const readResource = useCallback(
    async (uri: string): Promise<unknown> => {
      // Try scope first, then server
      if (scope) {
        return scope.readResource(uri);
      }
      if (server) {
        return server.readResource(uri);
      }
      throw new Error('No server or scope available');
    },
    [scope, server],
  );

  // List tools
  const listTools = useCallback((): { name: string; description?: string }[] => {
    // Try scope first, then server
    if (scope) {
      return scope.listTools().map((t) => ({
        name: t.name,
        description: t.description,
      }));
    }
    if (server) {
      return server.getTools().map((t) => ({
        name: t.name,
        description: t.description,
      }));
    }
    return [];
  }, [scope, server]);

  // List resources
  const listResources = useCallback((): { uri: string; name?: string; description?: string }[] => {
    // Try scope first, then server
    if (scope) {
      return scope.listResources().map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
      }));
    }
    if (server) {
      return server.getResources().map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
      }));
    }
    return [];
  }, [scope, server]);

  // Store pageElements in a ref so the handler can access the latest value
  const pageElementsRef = useRef(pageElements);
  pageElementsRef.current = pageElements;

  // Register page context resource
  useEffect(() => {
    if (!pageContextEnabled || !server) {
      return;
    }

    // Add page://current resource
    server.addResource({
      uri: 'page://current',
      name: 'Current Page Context',
      description: 'Returns the current page elements visible to the AI',
      handler: async () => {
        const elements = Array.from(pageElementsRef.current.values());
        return {
          contents: [
            {
              uri: 'page://current',
              mimeType: 'application/json',
              text: JSON.stringify({ elements }, null, 2),
            },
          ],
        };
      },
    });

    return () => {
      // Cleanup would remove the resource, but server doesn't have remove method yet
    };
  }, [server, pageContextEnabled]);

  // Register elicit tool
  useEffect(() => {
    if (!elicitEnabled || !server) {
      return;
    }

    // Add elicit tool for AI to request user input
    server.addTool({
      name: 'elicit',
      description: 'Request input or confirmation from the user',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: {
            type: 'string',
            enum: ['confirm', 'select', 'input', 'form'],
            description: 'Type of elicit request',
          },
          message: {
            type: 'string',
            description: 'Message to display to the user',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for select type',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds',
          },
        },
        required: ['type', 'message'],
      },
      handler: async (args) => {
        const request: ElicitRequest = {
          id: generateId(),
          type: args['type'] as ElicitRequest['type'],
          message: args['message'] as string,
          options: args['options'] as string[] | undefined,
          timeout: args['timeout'] as number | undefined,
        };

        return new Promise((resolve) => {
          elicitResolverRef.current = (response) => {
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ response }),
                },
              ],
            });
          };
          setPendingElicitRequest(request);

          // Handle timeout
          if (request.timeout) {
            setTimeout(() => {
              if (elicitResolverRef.current) {
                elicitResolverRef.current({ timeout: true });
                elicitResolverRef.current = null;
                setPendingElicitRequest(null);
              }
            }, request.timeout);
          }
        });
      },
    });

    return () => {
      // Cleanup would remove the tool
    };
  }, [server, elicitEnabled]);

  // Auto-start server or scope
  useEffect(() => {
    if (!autoStart || isConnected || isConnecting) {
      return;
    }

    // Need either server or scope to start
    if (!server && !scope) {
      return;
    }

    let mounted = true;

    const startServer = async () => {
      setIsConnecting(true);
      setError(null);

      try {
        if (scope) {
          await scope.start();
        } else if (server) {
          await server.start();
        }
        if (mounted) {
          setIsConnected(true);
          setIsConnecting(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsConnecting(false);
        }
      }
    };

    startServer();

    return () => {
      mounted = false;
    };
  }, [autoStart, scope, server, isConnected, isConnecting]);

  // Build context value
  const contextValue = useMemo(
    (): FrontMcpContextValue<TState> => ({
      server,
      scope,
      store: store ?? null,
      transport: transport ?? null,
      componentRegistry: componentRegistry ?? null,
      rendererRegistry: rendererRegistry ?? null,
      isConnected,
      isConnecting,
      error,
      pageElements,
      registerPageElement,
      unregisterPageElement,
      notifyAgent,
      pendingElicitRequest,
      respondToElicit,
      dismissElicit,
      callTool,
      readResource,
      listTools,
      listResources,
    }),
    [
      server,
      scope,
      store,
      transport,
      componentRegistry,
      rendererRegistry,
      isConnected,
      isConnecting,
      error,
      pageElements,
      registerPageElement,
      unregisterPageElement,
      notifyAgent,
      pendingElicitRequest,
      respondToElicit,
      dismissElicit,
      callTool,
      readResource,
      listTools,
      listResources,
    ],
  );

  return <FrontMcpContext.Provider value={contextValue as FrontMcpContextValue}>{children}</FrontMcpContext.Provider>;
}
