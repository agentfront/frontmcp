import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { StoreRegistry } from './providers/store-registry.provider';

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
 * Since MCP URI template params only capture a single path segment,
 * we register templates at each depth level.
 */
export function generateStoreResourceTemplates(registry: StoreRegistry): Array<new (...args: unknown[]) => unknown> {
  const templates: Array<new (...args: unknown[]) => unknown> = [];

  // Depth 0: state://{store}
  @ResourceTemplate({
    uriTemplate: 'state://{store}',
    name: 'Store State (root)',
    description: 'Read full store state',
  })
  class StoreRootResource extends ResourceContext {
    async read({ store }: { store: string }): Promise<ReadResourceResult> {
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      return {
        contents: [{ uri: `state://${store}`, text: JSON.stringify(storeAdapter.getState()) }],
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
  class StoreDepth1Resource extends ResourceContext {
    async read(args: Record<string, string>): Promise<ReadResourceResult> {
      const { store, p1 } = args;
      const path = [p1];
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: JSON.stringify(value) }] };
    }
  }
  templates.push(StoreDepth1Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 2: state://{store}/{p1}/{p2}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}',
    name: 'Store State (depth 2)',
    description: 'Read store state at depth 2',
  })
  class StoreDepth2Resource extends ResourceContext {
    async read(args: Record<string, string>): Promise<ReadResourceResult> {
      const { store, p1, p2 } = args;
      const path = [p1, p2];
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: JSON.stringify(value) }] };
    }
  }
  templates.push(StoreDepth2Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 3: state://{store}/{p1}/{p2}/{p3}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}/{p3}',
    name: 'Store State (depth 3)',
    description: 'Read store state at depth 3',
  })
  class StoreDepth3Resource extends ResourceContext {
    async read(args: Record<string, string>): Promise<ReadResourceResult> {
      const { store, p1, p2, p3 } = args;
      const path = [p1, p2, p3];
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: JSON.stringify(value) }] };
    }
  }
  templates.push(StoreDepth3Resource as unknown as new (...args: unknown[]) => unknown);

  // Depth 4: state://{store}/{p1}/{p2}/{p3}/{p4}
  @ResourceTemplate({
    uriTemplate: 'state://{store}/{p1}/{p2}/{p3}/{p4}',
    name: 'Store State (depth 4)',
    description: 'Read store state at depth 4',
  })
  class StoreDepth4Resource extends ResourceContext {
    async read(args: Record<string, string>): Promise<ReadResourceResult> {
      const { store, p1, p2, p3, p4 } = args;
      const path = [p1, p2, p3, p4];
      const storeAdapter = registry.get(store);
      if (!storeAdapter) throw new Error(`Store '${store}' not found`);
      const value = storeAdapter.getState(path);
      return { contents: [{ uri: buildUri(store, path), text: JSON.stringify(value) }] };
    }
  }
  templates.push(StoreDepth4Resource as unknown as new (...args: unknown[]) => unknown);

  return templates;
}
