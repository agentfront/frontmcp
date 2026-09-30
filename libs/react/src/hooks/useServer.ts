/**
 * useServer — access a named server from the shared ServerRegistry singleton.
 *
 * Uses useSyncExternalStore for tear-free reads. When no name is given,
 * returns the entry of the nearest FrontMcpProvider (`'default'` outside one).
 *
 * @example
 * ```tsx
 * const entry = useServer('analytics');
 * if (entry?.status === 'connected') {
 *   // entry.client is available
 * }
 * ```
 */

import { useCallback, useContext, useSyncExternalStore } from 'react';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import { serverRegistry, type ServerEntry } from '../registry/ServerRegistry';

export function useServer(name?: string): ServerEntry | undefined {
  const ctx = useContext(FrontMcpContext);
  const serverName = name ?? ctx.name;
  const subscribe = useCallback((cb: () => void) => serverRegistry.subscribe(cb), []);

  const getSnapshot = useCallback(() => {
    return serverRegistry.get(serverName);
  }, [serverName]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
