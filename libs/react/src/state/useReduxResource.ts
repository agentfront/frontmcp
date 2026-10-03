/**
 * useReduxResource — thin wrapper around useStoreResource for Redux stores.
 *
 * Accepts a standard Redux store and dispatches action creators as MCP tools.
 */

import { useMemo } from 'react';

import type { ReduxResourceOptions } from './state.types';
import { useStoreResource } from './useStoreResource';

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

  // Bound once per store: a new `subscribe` on every render would re-subscribe on every render
  const getState = useMemo(() => store.getState.bind(store), [store]);
  const subscribe = useMemo(() => store.subscribe.bind(store), [store]);

  useStoreResource({
    name,
    getState,
    subscribe,
    selectors,
    actions: wrappedActions,
    server,
  });
}
