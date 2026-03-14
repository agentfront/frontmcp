/**
 * Shared types for state management integration.
 */

export interface StoreResourceOptions {
  /** Name prefix for resources and tools (e.g., 'redux' → state://redux). */
  name: string;
  /** Returns the current state snapshot. */
  getState: () => unknown;
  /** Subscribes to state changes. Returns an unsubscribe function. */
  subscribe: (cb: () => void) => () => void;
  /** Named selectors — each becomes a sub-resource state://{name}/{key}. */
  selectors?: Record<string, (state: unknown) => unknown>;
  /** Named actions — each becomes a dynamic tool {name}_{key}. */
  actions?: Record<string, (...args: unknown[]) => unknown>;
  /** Target a specific named server. */
  server?: string;
}

export interface ReduxResourceOptions {
  /** Redux store with standard getState/dispatch/subscribe interface. */
  store: {
    getState(): unknown;
    dispatch(action: unknown): unknown;
    subscribe(fn: () => void): () => void;
  };
  /** Name prefix (defaults to 'redux'). */
  name?: string;
  /** Named selectors — each becomes a sub-resource. */
  selectors?: Record<string, (state: unknown) => unknown>;
  /** Named action creators — each becomes a dynamic tool that dispatches. */
  actions?: Record<string, (...args: unknown[]) => unknown>;
  /** Target a specific named server. */
  server?: string;
}

export interface ValtioResourceOptions {
  /** Valtio proxy object. */
  proxy: Record<string, unknown>;
  /** User-provided subscribe function from valtio/utils. */
  subscribe: (proxy: Record<string, unknown>, cb: () => void) => () => void;
  /** Name prefix (defaults to 'valtio'). */
  name?: string;
  /** Named deep path selectors (dot notation, e.g., 'user.name'). */
  paths?: Record<string, string>;
  /** Named mutations — each becomes a dynamic tool. */
  mutations?: Record<string, (...args: unknown[]) => void>;
  /** Target a specific named server. */
  server?: string;
}
