import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { StoreRegistry } from './providers/store-registry.provider';
import { StoreRegistryToken } from './store.symbols';

/**
 * Safely serialize a value to a JSON string.
 * Handles `undefined` which `JSON.stringify` returns as `undefined` (not a string).
 */
function serializeState(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/**
 * Build a state:// URI from store name and path segments.
 */
function buildUri(store: string, path: string[]): string {
  if (path.length === 0) return `state://${store}`;
  return `state://${store}/${path.join('/')}`;
}

/**
 * Generate resource template classes for state:// URIs at depths 0-4.
 *
 * When called without arguments (via dynamicResources), templates resolve
 * StoreRegistry via DI (this.get(StoreRegistryToken)).
 *
 * When called with a registry (legacy createResources path), templates
 * use the provided closure-based registry.
 */
export function generateStoreResourceTemplates(
  registryOverride?: StoreRegistry,
): Array<new (...args: unknown[]) => unknown> {
  const templates: Array<new (...args: unknown[]) => unknown> = [];

  // Depth 0: state://{store}
  @ResourceTemplate({
    uriTemplate: 'state://{store}',
    name: 'Store State (root)',
    description: 'Read full store state',
  })
  class StoreRootResource extends ResourceContext<{ store: string }> {
    async execute(_uri: string, params: { store: string }): Promise<ReadResourceResult> {
      const registry = registryOverride ?? this.get(StoreRegistryToken);
      const storeAdapter = registry.get(params.store);
      if (!storeAdapter) throw new Error(`Store '${params.store}' not found`);
      return {
        contents: [{ uri: buildUri(params.store, []), text: serializeState(storeAdapter.getState()) }],
      };
    }
  }
  templates.push(StoreRootResource as unknown as new (...args: unknown[]) => unknown);

  // Depth 1: state://{store}/{p1}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}',
    name: 'Store State (depth 1)',
    description: 'Read store state at depth 1',
  })
  class StoreDepth1Resource extends ResourceContext<{ store: string; p1: string }> {
    async execute(_uri: string, params: { store: string; p1: string }): Promise<ReadResourceResult> {
      const { store, p1 } = params;
      const path = [p1];
      const registry = registryOverride ?? this.get(StoreRegistryToken);
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: serializeState(value) }] };
    }
  }
  templates.push(StoreDepth1Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 2: state://{store}/{p1}/{p2}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}',
    name: 'Store State (depth 2)',
    description: 'Read store state at depth 2',
  })
  class StoreDepth2Resource extends ResourceContext<{ store: string; p1: string; p2: string }> {
    async execute(_uri: string, params: { store: string; p1: string; p2: string }): Promise<ReadResourceResult> {
      const { store, p1, p2 } = params;
      const path = [p1, p2];
      const registry = registryOverride ?? this.get(StoreRegistryToken);
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: serializeState(value) }] };
    }
  }
  templates.push(StoreDepth2Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 3: state://{store}/{p1}/{p2}/{p3}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}/{p3}',
    name: 'Store State (depth 3)',
    description: 'Read store state at depth 3',
  })
  class StoreDepth3Resource extends ResourceContext<{ store: string; p1: string; p2: string; p3: string }> {
    async execute(
      _uri: string,
      params: { store: string; p1: string; p2: string; p3: string },
    ): Promise<ReadResourceResult> {
      const { store, p1, p2, p3 } = params;
      const path = [p1, p2, p3];
      const registry = registryOverride ?? this.get(StoreRegistryToken);
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: serializeState(value) }] };
    }
  }
  templates.push(StoreDepth3Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 4: state://{store}/{p1}/{p2}/{p3}/{p4}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}/{p3}/{p4}',
    name: 'Store State (depth 4)',
    description: 'Read store state at depth 4',
  })
  class StoreDepth4Resource extends ResourceContext<{
    store: string;
    p1: string;
    p2: string;
    p3: string;
    p4: string;
  }> {
    async execute(
      _uri: string,
      params: { store: string; p1: string; p2: string; p3: string; p4: string },
    ): Promise<ReadResourceResult> {
      const { store, p1, p2, p3, p4 } = params;
      const path = [p1, p2, p3, p4];
      const registry = registryOverride ?? this.get(StoreRegistryToken);
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: serializeState(value) }] };
    }
  }
  templates.push(StoreDepth4Resource as unknown as new (...args: unknown[]) => unknown);

  return templates;
}
