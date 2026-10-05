/**
 * FrontMcpProvider — manages MCP client lifecycle for a pre-created server.
 *
 * 1. Receives an already-created `DirectMcpServer` via the `server` prop
 * 2. Optionally receives additional named servers via `servers` prop
 * 3. Merges developer-registered components into the ComponentRegistry
 * 4. Optionally auto-connects a client on mount (default: true)
 * 5. Registers all servers into the shared ServerRegistry singleton
 * 6. Creates a DynamicRegistry for dynamic tool/resource registration
 * 7. Mirrors dynamic tools into each server as real tools (bindDynamicTools), and keeps the
 *    listed tools current from the server's `notifications/tools/list_changed`
 * 8. Wraps the server to overlay dynamic resources on list/read operations
 * 9. All state (status, tools, etc.) lives in the ServerRegistry — context
 *    carries only `name`, `registry`, `dynamicRegistry`, and `connect`.
 */

import React, { useCallback, useEffect, useMemo, useRef, type ComponentType } from 'react';

import type { DirectClient, DirectMcpServer } from '@frontmcp/sdk';

import { ComponentRegistry } from '../components/ComponentRegistry';
import { bindDynamicTools } from '../registry/bindDynamicTools';
import { createWrappedServer } from '../registry/createWrappedServer';
import { DynamicRegistry } from '../registry/DynamicRegistry';
import { sameListing, serverRegistry } from '../registry/ServerRegistry';
import { useStoreRegistration } from '../state/useStoreRegistration';
import type { PromptInfo, ResourceInfo, ResourceTemplateInfo, StoreAdapter, ToolInfo } from '../types';
import { FrontMcpContext } from './FrontMcpContext';

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
  /**
   * Server app that dynamic tools join, by server name (the primary server goes by `name`). Needed
   * only for a server with more than one local app; a tool's own `app` option takes precedence.
   */
  dynamicToolApps?: Record<string, string>;
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
  dynamicToolApps,
  autoConnect = true,
  children,
  onConnected,
  onError,
}: FrontMcpProviderProps): React.ReactElement {
  const resolvedName = nameProp ?? 'default';

  const mountedRef = useRef(true);
  const clientRef = useRef<DirectClient | null>(null);
  const onErrorRef = useRef(onError);

  // Set after commit, never during render: a render React discards must not receive tool errors
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const registry = useMemo(() => {
    const reg = new ComponentRegistry();
    if (components) {
      reg.registerAll(components);
    }
    return reg;
  }, [components]);

  const registryMapRef = useRef(new Map<string, DynamicRegistry>());

  const getDynamicRegistry = useCallback(
    (serverName?: string): DynamicRegistry => {
      const key = serverName ?? resolvedName;
      let reg = registryMapRef.current.get(key);
      if (!reg) {
        reg = new DynamicRegistry();
        registryMapRef.current.set(key, reg);
      }
      return reg;
    },
    [resolvedName],
  );

  const dynamicRegistry = useMemo(() => getDynamicRegistry(resolvedName), [getDynamicRegistry, resolvedName]);

  // Register provider-level store adapters
  useStoreRegistration(stores ?? [], dynamicRegistry);

  // Wrap the server with the dynamic registry overlay
  const wrappedServer = useMemo(() => createWrappedServer(server, dynamicRegistry), [server, dynamicRegistry]);

  // A tool the server refuses (a name conflict, say) is reported, not thrown: the component that
  // registered it keeps rendering
  const reportToolError = useCallback((error: Error, toolName: string) => {
    const report = onErrorRef.current;
    if (report) report(new Error(`Dynamic tool "${toolName}" was not registered: ${error.message}`));
    else console.warn(`[frontmcp] dynamic tool "${toolName}" was not registered: ${error.message}`);
  }, []);

  // Keyed by content: an inline object is a new value on every render, which would re-bind every tool
  const dynamicToolAppsKey = JSON.stringify(dynamicToolApps ?? {});
  const toolApps = useMemo(
    () => JSON.parse(dynamicToolAppsKey) as Record<string, string | undefined>,
    [dynamicToolAppsKey],
  );
  const primaryToolApp = toolApps[resolvedName];

  // Mirror the primary server's dynamic tools into it as real tools
  useEffect(
    () => bindDynamicTools(dynamicRegistry, server, { onError: reportToolError, app: primaryToolApp }),
    [dynamicRegistry, server, reportToolError, primaryToolApp],
  );

  // Register all servers into the shared ServerRegistry
  useEffect(() => {
    const unbinds: (() => void)[] = [];
    serverRegistry.register(resolvedName, wrappedServer);
    if (servers) {
      for (const [sName, srv] of Object.entries(servers)) {
        const srvRegistry = getDynamicRegistry(sName);
        const wrappedSrv = createWrappedServer(srv, srvRegistry);
        serverRegistry.register(sName, wrappedSrv);
        unbinds.push(bindDynamicTools(srvRegistry, srv, { onError: reportToolError, app: toolApps[sName] }));
      }
    }

    return () => {
      unbinds.forEach((unbind) => {
        unbind();
      });
      serverRegistry.unregister(resolvedName);
      if (servers) {
        for (const sName of Object.keys(servers)) {
          serverRegistry.unregister(sName);
          const srvRegistry = registryMapRef.current.get(sName);
          if (srvRegistry) {
            srvRegistry.clear();
            registryMapRef.current.delete(sName);
          }
        }
      }
    };
  }, [resolvedName, wrappedServer, servers, getDynamicRegistry, reportToolError, toolApps]);

  // Refresh ServerRegistry entry when dynamic resources change. Dynamic tools reach the listing
  // through the server's `notifications/tools/list_changed` (see ServerRegistry.watchToolList).
  useEffect(() => {
    const refreshServerEntry = (name: string) => {
      const entry = serverRegistry.get(name);
      if (!entry || !entry.client) return;

      const srv = entry.server;
      if (!srv) return;

      srv
        .listResources()
        .then((resourcesResult) => {
          const resources = (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [];
          // A resource registered again unchanged (an effect re-running) is not a change: updating
          // anyway re-renders every reader of the server, which can run that effect again, forever
          const current = serverRegistry.get(name);
          if (mountedRef.current && current && !sameListing(current.resources, resources)) {
            serverRegistry.update(name, { resources });
          }
        })
        .catch(() => {
          // Non-critical — dynamic resources may still be read even if listing fails
        });
    };

    const unsubs: (() => void)[] = [];

    // Subscribe to primary server's dynamic registry
    unsubs.push(
      dynamicRegistry.subscribe(() => {
        refreshServerEntry(resolvedName);
      }),
    );

    // Subscribe to additional servers' dynamic registries
    if (servers) {
      for (const sName of Object.keys(servers)) {
        const srvRegistry = registryMapRef.current.get(sName);
        if (srvRegistry) {
          unsubs.push(
            srvRegistry.subscribe(() => {
              refreshServerEntry(sName);
            }),
          );
        }
      }
    }

    return () => {
      unsubs.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, resolvedName, servers]);

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
        // Merge dynamic resources into the initial listing (dynamic tools are server tools already)
        const dynamicResources = dynamicRegistry.getResources().map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));

        const baseTools = toolsResult as ToolInfo[];

        const baseResources = (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [];
        const dynamicResourceUris = new Set(dynamicResources.map((r) => r.uri));
        const filteredBaseResources = baseResources.filter((r) => !dynamicResourceUris.has(r.uri));

        serverRegistry.update(resolvedName, {
          client,
          status: 'connected',
          error: null,
          tools: Array.isArray(baseTools) ? baseTools : [],
          resources: [...filteredBaseResources, ...dynamicResources],
          resourceTemplates:
            (templatesResult as { resourceTemplates?: ResourceTemplateInfo[] }).resourceTemplates ?? [],
          prompts: (promptsResult as { prompts?: PromptInfo[] }).prompts ?? [],
        });

        serverRegistry.watchToolList(resolvedName, client);
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
      getDynamicRegistry,
      connect: connectClient,
    }),
    [resolvedName, registry, dynamicRegistry, getDynamicRegistry, connectClient],
  );

  return React.createElement(FrontMcpContext.Provider, { value: contextValue }, children);
}
