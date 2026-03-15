/**
 * reduxStore — adapter factory that normalizes a Redux store to the
 * common StoreAdapter interface for provider-level registration.
 */

import type { StoreAdapter } from '../../types';

export interface ReduxStoreOptions {
  /** Redux store instance. */
  store: {
    getState(): unknown;
    dispatch(action: unknown): unknown;
    subscribe(fn: () => void): () => void;
  };
  /** Logical name (defaults to 'redux'). */
  name?: string;
  /** Named selectors — each becomes a sub-resource. */
  selectors?: Record<string, (state: unknown) => unknown>;
  /** Named action creators — each becomes a dynamic tool that auto-dispatches. */
  actions?: Record<string, (...args: unknown[]) => unknown>;
}

export function reduxStore(options: ReduxStoreOptions): StoreAdapter {
  const { store, name = 'redux', selectors, actions: rawActions } = options;

  // Wrap action creators to auto-dispatch
  let actions: Record<string, (...args: unknown[]) => unknown> | undefined;
  if (rawActions) {
    actions = {};
    for (const [key, actionCreator] of Object.entries(rawActions)) {
      actions[key] = (...args: unknown[]) => {
        const action = actionCreator(...args);
        return store.dispatch(action);
      };
    }
  }

  return {
    name,
    getState: store.getState.bind(store),
    subscribe: store.subscribe.bind(store),
    selectors,
    actions,
  };
}
