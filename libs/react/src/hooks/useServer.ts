/**
 * useServer — access a named server from the shared ServerRegistry singleton.
 *
 * Uses useSyncExternalStore for tear-free reads. When no name is given,
 * returns the 'default' server entry (the one from FrontMcpProvider).
 *
 * @example
 * ```tsx
 * const entry = useServer('analytics');
 * if (entry?.status === 'connected') {
 *   // entry.client is available
 * }
 * ```
 */

import { useSyncExternalStore, useCallback } from 'react';
import { serverRegistry } from '../registry/ServerRegistry';
import type { ServerEntry } from '../registry/ServerRegistry';

export function useServer(name?: string): ServerEntry | undefined {
  const subscribe = useCallback((cb: () => void) => serverRegistry.subscribe(cb), []);

  const getSnapshot = useCallback(() => {
    return serverRegistry.get(name ?? 'default');
  }, [name]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
