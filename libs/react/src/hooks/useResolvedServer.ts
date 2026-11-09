/**
 * useResolvedServer — internal shared hook that resolves a server entry.
 *
 * Without args: resolves the provider's server name from context.
 * With a name: resolves the named server from the ServerRegistry.
 */

import { useContext } from 'react';

import type { ComponentRegistry } from '../components/ComponentRegistry';
import { FrontMcpContext } from '../provider/FrontMcpContext';
import type { ServerEntry } from '../registry/ServerRegistry';
import { useServer } from './useServer';

export interface ResolvedServerEntry {
  entry: ServerEntry | undefined;
  name: string;
  registry: ComponentRegistry;
  connect: () => Promise<void>;
}

export function useResolvedServer(serverName?: string): ResolvedServerEntry {
  const ctx = useContext(FrontMcpContext);
  const resolvedName = serverName ?? ctx.name;
  const entry = useServer(resolvedName);
  return { entry, name: resolvedName, registry: ctx.registry, connect: ctx.connect };
}
