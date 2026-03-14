/**
 * @frontmcp/react/state — State management integration for FrontMCP.
 *
 * Exposes Redux, Valtio, or any store as MCP resources (with deep selectors)
 * and actions as MCP tools that agents can invoke.
 *
 * @packageDocumentation
 */

export { useStoreResource } from './useStoreResource';
export { useReduxResource } from './useReduxResource';
export { useValtioResource } from './useValtioResource';
export type { StoreResourceOptions, ReduxResourceOptions, ValtioResourceOptions } from './state.types';
export { reduxStore, valtioStore, createStore } from './adapters';
export type { ReduxStoreOptions, ValtioStoreOptions, CreateStoreOptions } from './adapters';
