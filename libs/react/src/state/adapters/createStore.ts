/**
 * createStore — generic pass-through adapter factory for any custom store.
 *
 * Accepts a StoreAdapter-compatible object directly.
 */

import type { StoreAdapter } from '../../types';

export interface CreateStoreOptions {
  name: string;
  getState: () => unknown;
  subscribe: (cb: () => void) => () => void;
  selectors?: Record<string, (state: unknown) => unknown>;
  actions?: Record<string, (...args: unknown[]) => unknown>;
}

export function createStore(options: CreateStoreOptions): StoreAdapter {
  return {
    name: options.name,
    getState: options.getState,
    subscribe: options.subscribe,
    selectors: options.selectors,
    actions: options.actions,
  };
}
