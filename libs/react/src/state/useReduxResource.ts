/**
 * useReduxResource — thin wrapper around useStoreResource for Redux stores.
 *
 * Accepts a standard Redux store and dispatches action creators as MCP tools.
 */

import { useMemo } from 'react';
import { useStoreResource } from './useStoreResource';
import type { ReduxResourceOptions } from './state.types';

export function useReduxResource(options: ReduxResourceOptions): void {
  const { store, name = 'redux', selectors, actions, server } = options;

  // Wrap action creators to auto-dispatch
  const wrappedActions = useMemo(() => {
    if (!actions) return undefined;
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [key, actionCreator] of Object.entries(actions)) {
      wrapped[key] = (...args: unknown[]) => {
        const action = actionCreator(...args);
        return store.dispatch(action);
      };
    }
    return wrapped;
  }, [actions, store]);

  useStoreResource({
    name,
    getState: store.getState.bind(store),
    subscribe: store.subscribe.bind(store),
    selectors,
    actions: wrappedActions,
    server,
  });
}
