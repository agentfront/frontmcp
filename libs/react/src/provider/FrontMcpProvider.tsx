/**
 * FrontMcpProvider — manages MCP client lifecycle for a pre-created server.
 *
 * 1. Receives an already-created `DirectMcpServer` via the `server` prop
 * 2. Optionally receives additional named servers via `servers` prop
 * 3. Merges developer-registered components into the ComponentRegistry
 * 4. Optionally auto-connects a client on mount (default: true)
 * 5. Registers all servers into the shared ServerRegistry singleton
 * 6. Creates a DynamicRegistry for dynamic tool/resource registration
 * 7. Wraps the server to overlay dynamic entries on list/call operations
 * 8. All state (status, tools, etc.) lives in the ServerRegistry — context
 *    carries only `name`, `registry`, `dynamicRegistry`, and `connect`.
 */

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import type { ComponentType } from 'react';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import type { ToolInfo, ResourceInfo, ResourceTemplateInfo, PromptInfo } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';
import { DynamicRegistry } from '../registry/DynamicRegistry';
import { createWrappedServer } from '../registry/createWrappedServer';
import type { StoreAdapter } from '../types';
import { FrontMcpContext } from './FrontMcpContext';
import { serverRegistry } from '../registry/ServerRegistry';
import { useStoreRegistration } from '../state/useStoreRegistration';

export interface FrontMcpProviderProps {
  /** Logical name for the primary server (defaults to 'default') */
  name?: string;
  /** Primary MCP server — registered under `name` in ServerRegistry */
  server: DirectMcpServer;
  /** Additional named servers — each registered by key in ServerRegistry */
  servers?: Record<string, DirectMcpServer>;
  components?: Record<string, ComponentType<Record<string, unknown>>>;
  /** Store adapters to register at the provider level (reduxStore, valtioStore, createStore). */
  stores?: StoreAdapter[];
  autoConnect?: boolean;
  children: React.ReactNode;
  onConnected?: (client: DirectClient) => void;
  onError?: (error: Error) => void;
}

export function FrontMcpProvider({
  name: nameProp,
  server,
  servers,
  components,
  stores,
  autoConnect = true,
  children,
  onConnected,
  onError,
}: FrontMcpProviderProps): React.ReactElement {
  const resolvedName = nameProp ?? 'default';

  const mountedRef = useRef(true);
  const clientRef = useRef<DirectClient | null>(null);

  const registry = useMemo(() => {
    const reg = new ComponentRegistry();
    if (components) {
      reg.registerAll(components);
    }
    return reg;
  }, [components]);

  const dynamicRegistry = useMemo(() => new DynamicRegistry(), []);

  // Register provider-level store adapters
  useStoreRegistration(stores ?? [], dynamicRegistry);

  // Wrap the server with the dynamic registry overlay
  const wrappedServer = useMemo(() => createWrappedServer(server, dynamicRegistry), [server, dynamicRegistry]);

  // Register all servers into the shared ServerRegistry
  useEffect(() => {
    serverRegistry.register(resolvedName, wrappedServer);
    if (servers) {
      for (const [sName, srv] of Object.entries(servers)) {
        serverRegistry.register(sName, srv);
      }
    }

    return () => {
      serverRegistry.unregister(resolvedName);
      if (servers) {
        for (const sName of Object.keys(servers)) {
          serverRegistry.unregister(sName);
        }
      }
    };
  }, [resolvedName, wrappedServer, servers]);

  // Refresh ServerRegistry entry when dynamic tools/resources change
  useEffect(() => {
    return dynamicRegistry.subscribe(() => {
      const entry = serverRegistry.get(resolvedName);
      if (!entry || !entry.client) return;

      // Re-list tools and resources by calling the wrapped server
      Promise.all([wrappedServer.listTools(), wrappedServer.listResources()])
        .then(([toolsResult, resourcesResult]) => {
          if (mountedRef.current) {
            serverRegistry.update(resolvedName, {
              tools: (toolsResult as { tools?: ToolInfo[] }).tools ?? [],
              resources: (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [],
            });
          }
        })
        .catch(() => {
          // Non-critical — dynamic tools may still work via callTool even if listing fails
        });
    });
  }, [dynamicRegistry, wrappedServer, resolvedName]);

  const connectClient = useCallback(async () => {
    if (clientRef.current) return;

    try {
      serverRegistry.update(resolvedName, { status: 'connecting', error: null });

      const client = await wrappedServer.connect();
      clientRef.current = client;

      // Each list call may fail if the server doesn't support that capability.
      // Use individual catch blocks to gracefully handle missing capabilities.
      const safeList = <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => fn().catch(() => fallback);

      const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
        safeList(() => client.listTools(), []),
        safeList(() => client.listResources(), { resources: [] }),
        safeList(() => client.listResourceTemplates(), { resourceTemplates: [] }),
        safeList(() => client.listPrompts(), { prompts: [] }),
      ]);

      if (mountedRef.current) {
        // Merge dynamic tools/resources into the initial listing
        const dynamicTools = dynamicRegistry.getTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        const dynamicResources = dynamicRegistry.getResources().map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));

        const baseTools = toolsResult as ToolInfo[];
        const dynamicToolNames = new Set(dynamicTools.map((t) => t.name));
        const filteredBaseTools = (Array.isArray(baseTools) ? baseTools : []).filter(
          (t) => !dynamicToolNames.has(t.name),
        );

        const baseResources = (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [];
        const dynamicResourceUris = new Set(dynamicResources.map((r) => r.uri));
        const filteredBaseResources = baseResources.filter((r) => !dynamicResourceUris.has(r.uri));

        serverRegistry.update(resolvedName, {
          client,
          status: 'connected',
          error: null,
          tools: [...filteredBaseTools, ...dynamicTools],
          resources: [...filteredBaseResources, ...dynamicResources],
          resourceTemplates:
            (templatesResult as { resourceTemplates?: ResourceTemplateInfo[] }).resourceTemplates ?? [],
          prompts: (promptsResult as { prompts?: PromptInfo[] }).prompts ?? [],
        });

        onConnected?.(client);
      }

      // Auto-connect additional servers (non-critical; failures don't block the primary provider)
      if (servers) {
        for (const sName of Object.keys(servers)) {
          serverRegistry.connect(sName).catch(() => {});
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        serverRegistry.update(resolvedName, { error: e, status: 'error' });
        onError?.(e);
      }
    }
  }, [resolvedName, wrappedServer, servers, onConnected, onError, dynamicRegistry]);

  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connectClient();
    }

    return () => {
      mountedRef.current = false;
      clientRef.current = null;
    };
  }, [autoConnect, connectClient]);

  const contextValue = useMemo(
    () => ({
      name: resolvedName,
      registry,
      dynamicRegistry,
      connect: connectClient,
    }),
    [resolvedName, registry, dynamicRegistry, connectClient],
  );

  return React.createElement(FrontMcpContext.Provider, { value: contextValue }, children);
}
