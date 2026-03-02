import { useState, useCallback, type ReactNode } from 'react';
import { ServerRegistry } from '@frontmcp/react';
import StorePlugin from '@frontmcp/plugin-store';
import { ServerManagerContext, type ManagedServer, type ServerConfig } from './ServerManagerContext';
import { toolCatalog, resourceCatalog, promptCatalog, lookupEntries } from '../catalog/available-entries';
import { counterStore, todoStore } from '../stores/demo-store';
import type { ToolType, ResourceType, PromptType, PluginType } from '@frontmcp/sdk';

interface ServerManagerProviderProps {
  initialServers: ManagedServer[];
  defaultActiveId: string;
  children: ReactNode;
}

let serverCounter = 0;

export function ServerManagerProvider({ initialServers, defaultActiveId, children }: ServerManagerProviderProps) {
  const [servers, setServers] = useState<ManagedServer[]>(initialServers);
  const [activeServerId, setActiveServerId] = useState<string>(defaultActiveId);

  const setActiveServer = useCallback((id: string) => {
    setActiveServerId(id);
  }, []);

  const createServer = useCallback(async (name: string, config: ServerConfig): Promise<ManagedServer> => {
    serverCounter++;
    const registryName = `user-${serverCounter}-${Date.now()}`;

    const tools = lookupEntries(toolCatalog, config.toolIds) as ToolType[];
    const resources = lookupEntries(resourceCatalog, config.resourceIds) as ResourceType[];
    const prompts = lookupEntries(promptCatalog, config.promptIds) as PromptType[];

    const plugins: PluginType[] = [];
    if (config.hasStorePlugin) {
      plugins.push(StorePlugin.init({ stores: { counter: counterStore, todos: todoStore } }));
    }

    const server = await ServerRegistry.create(registryName, {
      info: { name: registryName, version: '1.0.0' },
      tools,
      resources,
      prompts,
      plugins,
      machineId: `browser-${registryName}`,
    });

    const managed: ManagedServer = {
      id: registryName,
      name,
      server,
      config,
      createdAt: Date.now(),
    };

    setServers((prev) => [...prev, managed]);
    return managed;
  }, []);

  const removeServer = useCallback(
    async (id: string) => {
      setServers((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s.id !== id);
      });
      setActiveServerId((prev) => {
        if (prev !== id) return prev;
        // Switch to first remaining server
        return servers.find((s) => s.id !== id)?.id ?? prev;
      });
      await ServerRegistry.dispose(id);
    },
    [servers],
  );

  return (
    <ServerManagerContext.Provider value={{ servers, activeServerId, setActiveServer, createServer, removeServer }}>
      {children}
    </ServerManagerContext.Provider>
  );
}
