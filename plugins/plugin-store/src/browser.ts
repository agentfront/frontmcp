/**
 * @frontmcp/plugin-store - Browser Entry Point
 *
 * All store functionality is browser-compatible (Valtio uses no Node.js APIs).
 *
 * @packageDocumentation
 */

// Main plugin
export { default, default as StorePlugin } from './store.plugin';

// Symbols (DI tokens)
export { StoreRegistryToken, StoreAccessorToken } from './store.symbols';

// Types
export type { StoreAdapter, StoreEntry, StorePluginOptions } from './store.types';

// Adapters
export { createValtioStore } from './adapters/valtio.adapter';

// Providers
export { StoreRegistry } from './providers/store-registry.provider';
export { StoreAccessor } from './providers/store-accessor.provider';

// Resources
export { generateStoreResourceTemplates } from './store.resources';

// Context Extension Types & Helper Functions
export { getStore, tryGetStore } from './store.context-extension';
