/**
 * useValtioResource — thin wrapper around useStoreResource for Valtio proxies.
 *
 * The user must pass valtio's `subscribe` function since it's an optional peer dep.
 * Deep path selectors use dot notation (e.g., 'user.profile.name').
 */

import { useMemo } from 'react';
import { useStoreResource } from './useStoreResource';
import type { ValtioResourceOptions } from './state.types';

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function useValtioResource(options: ValtioResourceOptions): void {
  const { proxy, subscribe: valtioSubscribe, name = 'valtio', paths, mutations, server } = options;

  // Build selectors from dot-notation paths
  const selectors = useMemo(() => {
    if (!paths) return undefined;
    const sels: Record<string, (state: unknown) => unknown> = {};
    for (const [key, path] of Object.entries(paths)) {
      sels[key] = (state: unknown) => getByPath(state, path);
    }
    return sels;
  }, [paths]);

  // Wrap valtio subscribe to match the standard interface
  const subscribe = useMemo(() => (cb: () => void) => valtioSubscribe(proxy, cb), [proxy, valtioSubscribe]);

  // Wrap mutations to pass the proxy as first arg
  const actions = useMemo(() => {
    if (!mutations) return undefined;
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [key, mutation] of Object.entries(mutations)) {
      wrapped[key] = (...args: unknown[]) => mutation(...args);
    }
    return wrapped;
  }, [mutations]);

  // Valtio proxies are the state themselves — snapshot for reads
  const getState = useMemo(() => () => JSON.parse(JSON.stringify(proxy)), [proxy]);

  useStoreResource({
    name,
    getState,
    subscribe,
    selectors,
    actions,
    server,
  });
}
