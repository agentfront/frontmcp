// file: libs/browser/src/store/store-resource.ts
/**
 * Store Resource - Exposes Valtio store state as an MCP resource.
 *
 * This allows MCP clients to read the current application state.
 *
 * @example
 * ```typescript
 * import { createMcpStore } from '@frontmcp/browser';
 * import { createStoreResource } from '@frontmcp/browser/store';
 *
 * interface AppState {
 *   user: { name: string } | null;
 *   settings: { theme: 'light' | 'dark' };
 * }
 *
 * const store = createMcpStore<AppState>({
 *   initialState: { user: null, settings: { theme: 'light' } },
 * });
 *
 * // Create a resource for the entire state
 * const stateResource = createStoreResource(store, {
 *   uri: 'app://state',
 *   name: 'Application State',
 *   description: 'Current application state',
 * });
 *
 * // Or create a resource for a specific key
 * const settingsResource = createStoreResource(store, {
 *   uri: 'app://settings',
 *   name: 'Settings',
 *   selector: (state) => state.settings,
 * });
 *
 * // Register with scope
 * scope.registerResource(stateResource);
 * ```
 */

import type { McpStore } from './store.types';
import type { ScopeResourceDefinition } from '../scope/types';

/**
 * Options for creating a store resource.
 */
export interface StoreResourceOptions<T extends object, R = T> {
  /** Resource URI */
  uri: string;

  /** Resource name */
  name: string;

  /** Resource description */
  description?: string;

  /** MIME type for the resource (default: application/json) */
  mimeType?: string;

  /**
   * Selector function to extract specific state.
   * If not provided, returns the entire store state.
   */
  selector?: (state: Readonly<T>) => R;

  /**
   * Transform function for custom serialization.
   * If not provided, uses JSON.stringify.
   */
  transform?: (data: R) => string;
}

/**
 * Create an MCP resource definition from a store.
 *
 * This creates a resource that returns the current store state
 * (or a subset of it via selector) when read.
 *
 * @template T - The store state type
 * @template R - The return type (defaults to T)
 * @param store - The MCP store
 * @param options - Resource options
 * @returns A ScopeResourceDefinition compatible with BrowserScope
 */
export function createStoreResource<T extends object, R = T>(
  store: McpStore<T>,
  options: StoreResourceOptions<T, R>,
): ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  const { uri, name, description, mimeType = 'application/json', selector, transform } = options;

  return {
    uri,
    name,
    description,
    mimeType,
    handler: () => {
      const state = store.getSnapshot();
      const data = selector ? selector(state) : (state as unknown as R);
      const text = transform ? transform(data) : JSON.stringify(data, null, 2);

      return {
        uri,
        mimeType,
        text,
      };
    },
  };
}

/**
 * Create multiple store resources from a mapping.
 *
 * Convenience function for creating multiple resources at once.
 *
 * @example
 * ```typescript
 * const resources = createStoreResources(store, {
 *   'app://user': {
 *     name: 'User',
 *     selector: (s) => s.user,
 *   },
 *   'app://settings': {
 *     name: 'Settings',
 *     selector: (s) => s.settings,
 *   },
 * });
 * ```
 */
export function createStoreResources<T extends object>(
  store: McpStore<T>,
  resources: Record<string, Omit<StoreResourceOptions<T, unknown>, 'uri'>>,
): ScopeResourceDefinition[] {
  return Object.entries(resources).map(([uri, options]) => createStoreResource(store, { ...options, uri }));
}
