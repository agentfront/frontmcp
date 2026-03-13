/**
 * FrontMcpProvider — manages MCP client lifecycle for a pre-created server.
 *
 * 1. Receives an already-created `DirectMcpServer` via the `server` prop
 * 2. Optionally receives additional named servers via `servers` prop
 * 3. Merges developer-registered components into the ComponentRegistry
 * 4. Optionally auto-connects a client on mount (default: true)
 * 5. Registers all servers into the shared ServerRegistry singleton
 * 6. All state (status, tools, etc.) lives in the ServerRegistry — context
 *    carries only `name`, `registry`, and `connect`.
 */

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import type { ComponentType } from 'react';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import type { ToolInfo, ResourceInfo, ResourceTemplateInfo, PromptInfo } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';
import { FrontMcpContext } from './FrontMcpContext';
import { serverRegistry } from '../registry/ServerRegistry';

export interface FrontMcpProviderProps {
  /** Logical name for the primary server (defaults to 'default') */
  name?: string;
  /** Primary MCP server — registered under `name` in ServerRegistry */
  server: DirectMcpServer;
  /** Additional named servers — each registered by key in ServerRegistry */
  servers?: Record<string, DirectMcpServer>;
  components?: Record<string, ComponentType<Record<string, unknown>>>;
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

  // Register all servers into the shared ServerRegistry
  useEffect(() => {
    serverRegistry.register(resolvedName, server);
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
  }, [resolvedName, server, servers]);

  const connectClient = useCallback(async () => {
    if (clientRef.current) return;

    try {
      serverRegistry.update(resolvedName, { status: 'connecting', error: null });

      const client = await server.connect();
      clientRef.current = client;

      const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listResourceTemplates(),
        client.listPrompts(),
      ]);

      if (mountedRef.current) {
        serverRegistry.update(resolvedName, {
          client,
          status: 'connected',
          error: null,
          tools: toolsResult as ToolInfo[],
          resources: (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [],
          resourceTemplates:
            (templatesResult as { resourceTemplates?: ResourceTemplateInfo[] }).resourceTemplates ?? [],
          prompts: (promptsResult as { prompts?: PromptInfo[] }).prompts ?? [],
        });

        onConnected?.(client);
      }

      // Auto-connect additional servers
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
  }, [resolvedName, server, servers, onConnected, onError]);

  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connectClient();
    }

    return () => {
      mountedRef.current = false;
      clientRef.current = null;
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      name: resolvedName,
      registry,
      connect: connectClient,
    }),
    [resolvedName, registry, connectClient],
  );

  return React.createElement(FrontMcpContext.Provider, { value: contextValue }, children);
}
