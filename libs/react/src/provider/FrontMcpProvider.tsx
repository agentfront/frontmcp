/**
 * FrontMcpProvider — manages MCP client lifecycle for a pre-created server.
 *
 * 1. Receives an already-created `DirectMcpServer` via the `server` prop
 * 2. Merges developer-registered components into the ComponentRegistry
 * 3. Optionally auto-connects a client on mount (default: true)
 * 4. Fetches tool/resource/prompt lists after connecting
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ComponentType } from 'react';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import type { FrontMcpStatus, ToolInfo, ResourceInfo, ResourceTemplateInfo, PromptInfo } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';
import { FrontMcpContext } from './FrontMcpContext';

export interface FrontMcpProviderProps {
  server: DirectMcpServer;
  components?: Record<string, ComponentType<Record<string, unknown>>>;
  autoConnect?: boolean;
  children: React.ReactNode;
  onConnected?: (client: DirectClient) => void;
  onError?: (error: Error) => void;
}

export function FrontMcpProvider({
  server,
  components,
  autoConnect = true,
  children,
  onConnected,
  onError,
}: FrontMcpProviderProps): React.ReactElement {
  const [status, setStatus] = useState<FrontMcpStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [resources, setResources] = useState<ResourceInfo[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<ResourceTemplateInfo[]>([]);
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);

  const clientRef = useRef<DirectClient | null>(null);
  const mountedRef = useRef(true);

  const registry = useMemo(() => {
    const reg = new ComponentRegistry();
    if (components) {
      reg.registerAll(components);
    }
    return reg;
  }, [components]);

  const connectClient = useCallback(async () => {
    if (clientRef.current) return;

    try {
      if (mountedRef.current) {
        setStatus('connecting');
        setError(null);
      }

      const client = await server.connect();
      clientRef.current = client;

      const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listResourceTemplates(),
        client.listPrompts(),
      ]);

      if (mountedRef.current) {
        setTools(toolsResult as ToolInfo[]);
        setResources((resourcesResult as { resources?: ResourceInfo[] }).resources ?? []);
        setResourceTemplates(
          (templatesResult as { resourceTemplates?: ResourceTemplateInfo[] }).resourceTemplates ?? [],
        );
        setPrompts((promptsResult as { prompts?: PromptInfo[] }).prompts ?? []);
        setStatus('connected');
        onConnected?.(client);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(e);
        setStatus('error');
        onError?.(e);
      }
    }
  }, [server, onConnected, onError]);

  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connectClient();
    }

    return () => {
      mountedRef.current = false;
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextValue = useMemo(
    () => ({
      status,
      error,
      server,
      client: clientRef.current,
      tools,
      resources,
      resourceTemplates,
      prompts,
      registry,
      connect: connectClient,
    }),
    [status, error, server, tools, resources, resourceTemplates, prompts, registry, connectClient],
  );

  return React.createElement(FrontMcpContext.Provider, { value: contextValue }, children);
}
