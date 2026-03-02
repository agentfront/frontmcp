/**
 * StorePlugin - Reactive State Stores for FrontMCP
 *
 * Provides named reactive stores accessible via MCP resources and tool context.
 *
 * @example
 * ```typescript
 * import StorePlugin, { createValtioStore } from '@frontmcp/plugin-store';
 *
 * const counterStore = createValtioStore({ count: 0 });
 *
 * const server = await ServerRegistry.create('demo', {
 *   plugins: [StorePlugin.init({ stores: { counter: counterStore } })],
 *   resources: StorePlugin.createResources({ counter: counterStore }),
 * });
 *
 * // In tools: this.store.get('counter', ['count'])
 * ```
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
