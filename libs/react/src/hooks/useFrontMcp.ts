/**
 * useFrontMcp — access a resolved server by name, or the default provider server.
 *
 * @param name - optional server name; defaults to the provider's `name`.
 */

import type { ResolvedServer } from '../types';
import { useResolvedServer } from './useResolvedServer';

export function useFrontMcp(name?: string): ResolvedServer {
  const { entry, name: resolvedName, registry, connect } = useResolvedServer(name);
  return {
    name: resolvedName,
    server: entry?.server ?? null,
    client: entry?.client ?? null,
    status: entry?.status ?? 'idle',
    error: entry?.error ?? null,
    tools: entry?.tools ?? [],
    resources: entry?.resources ?? [],
    resourceTemplates: entry?.resourceTemplates ?? [],
    prompts: entry?.prompts ?? [],
    registry,
    connect,
  };
}
