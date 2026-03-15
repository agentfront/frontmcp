/**
 * valtioStore — adapter factory that normalizes a Valtio proxy to the
 * common StoreAdapter interface for provider-level registration.
 */

import type { StoreAdapter } from '../../types';

export interface ValtioStoreOptions {
  /** Valtio proxy object. */
  proxy: Record<string, unknown>;
  /** User-provided subscribe function from valtio/utils. */
  subscribe: (proxy: Record<string, unknown>, cb: () => void) => () => void;
  /** Logical name (defaults to 'valtio'). */
  name?: string;
  /** Named deep path selectors (dot notation, e.g., 'user.name'). */
  paths?: Record<string, string>;
  /** Named mutations — each becomes a dynamic tool. */
  mutations?: Record<string, (...args: unknown[]) => void>;
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function valtioStore(options: ValtioStoreOptions): StoreAdapter {
  const { proxy, subscribe: valtioSubscribe, name = 'valtio', paths, mutations } = options;

  // Build selectors from dot-notation paths
  let selectors: Record<string, (state: unknown) => unknown> | undefined;
  if (paths) {
    selectors = {};
    for (const [key, path] of Object.entries(paths)) {
      selectors[key] = (state: unknown) => getByPath(state, path);
    }
  }

  // Wrap mutations as actions
  let actions: Record<string, (...args: unknown[]) => unknown> | undefined;
  if (mutations) {
    actions = {};
    for (const [key, mutation] of Object.entries(mutations)) {
      actions[key] = (...args: unknown[]) => mutation(...args);
    }
  }

  return {
    name,
    getState: () => JSON.parse(JSON.stringify(proxy)),
    subscribe: (cb: () => void) => valtioSubscribe(proxy, cb),
    selectors,
    actions,
  };
}
