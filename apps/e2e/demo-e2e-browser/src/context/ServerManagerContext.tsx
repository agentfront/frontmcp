import { createContext, useContext } from 'react';
import type { DirectMcpServer } from '@frontmcp/react';

export interface ServerConfig {
  toolIds: string[];
  resourceIds: string[];
  promptIds: string[];
  hasStorePlugin: boolean;
}

export interface ManagedServer {
  id: string;
  name: string;
  server: DirectMcpServer;
  config: ServerConfig;
  createdAt: number;
}

export interface ServerManagerContextValue {
  servers: ManagedServer[];
  activeServerId: string | null;
  setActiveServer: (id: string) => void;
  createServer: (name: string, config: ServerConfig) => Promise<ManagedServer>;
  removeServer: (id: string) => Promise<void>;
}

export const ServerManagerContext = createContext<ServerManagerContextValue | null>(null);

export function useServerManager(): ServerManagerContextValue {
  const ctx = useContext(ServerManagerContext);
  if (!ctx) throw new Error('useServerManager must be used within a ServerManagerProvider');
  return ctx;
}
