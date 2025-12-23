// file: libs/browser/src/store/schema-store-resources.ts
/**
 * Schema Store Resources - MCP resource generation from schema stores.
 *
 * Provides utilities for creating MCP resources from schema store state
 * with support for subscriptions, templates, and computed values.
 *
 * @example Basic usage
 * ```typescript
 * import { defineStore, createSchemaStoreResources } from '@frontmcp/browser';
 *
 * const store = defineStore({
 *   name: 'todos',
 *   schema: z.object({
 *     items: z.array(todoSchema),
 *     filter: z.enum(['all', 'active', 'completed']),
 *   }),
 *   actions: { ... },
 *   computed: {
 *     filteredItems: (state) => state.items.filter(...),
 *   },
 * });
 *
 * // Create resources with custom configuration
 * const resources = createSchemaStoreResources(store, {
 *   includeComputed: true,
 *   includeKeys: ['items', 'filter'],
 *   templates: {
 *     'store://todos/item/{id}': {
 *       name: 'Todo Item',
 *       selector: (state, params) => state.items.find(i => i.id === params.id),
 *     },
 *   },
 * });
 * ```
 */

import { snapshot } from 'valtio';
import type { SchemaStore, StoreActions, ComputedDefs, ComputedValues } from './schema-store';
import type { ScopeResourceDefinition } from '../scope/types';
import type { McpStore } from './store.types';

// =============================================================================
// Types
// =============================================================================

/**
 * Resource configuration for a store key or computed value.
 */
export interface StoreResourceConfig<T, R = unknown> {
  /** Resource name */
  name?: string;

  /** Resource description */
  description?: string;

  /** Custom selector to transform data */
  selector?: (data: T) => R;

  /** Custom serializer (default: JSON.stringify) */
  serialize?: (data: R) => string;

  /** MIME type (default: application/json) */
  mimeType?: string;

  /** Enable subscriptions for this resource */
  subscribe?: boolean;
}

/**
 * Template resource configuration with URI parameters.
 */
export interface TemplateResourceConfig<T extends object, R = unknown> {
  /** Resource name */
  name: string;

  /** Resource description */
  description?: string;

  /** Selector function with state and URI params */
  selector: (state: Readonly<T>, params: Record<string, string>) => R | undefined;

  /** Custom serializer */
  serialize?: (data: R) => string;

  /** MIME type */
  mimeType?: string;
}

/**
 * Options for creating schema store resources.
 */
export interface SchemaStoreResourcesOptions<T extends object, TComputed extends ComputedDefs<T>> {
  /** Include main state resource (default: true) */
  includeMain?: boolean;

  /** Include resources for each state key (default: true) */
  includeKeys?: boolean | (keyof T)[];

  /** Include computed value resources (default: true if computed defined) */
  includeComputed?: boolean | (keyof TComputed)[];

  /** Custom configurations for specific keys */
  keyConfigs?: {
    [K in keyof T]?: StoreResourceConfig<T[K]>;
  };

  /** Custom configurations for computed values */
  computedConfigs?: {
    [K in keyof TComputed]?: StoreResourceConfig<ComputedValues<T, TComputed>[K]>;
  };

  /** Template resources with URI parameters */
  templates?: Record<string, TemplateResourceConfig<T>>;

  /** URI prefix (default: 'store://') */
  uriPrefix?: string;

  /** Enable subscriptions for all resources (default: false) */
  subscribeAll?: boolean;
}

/**
 * Generated resource with additional metadata.
 */
export interface SchemaStoreResource extends ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  /** Store name */
  storeName: string;

  /** Resource type */
  resourceType: 'main' | 'key' | 'computed' | 'template';

  /** Key name (for key/computed resources) */
  keyName?: string;

  /** Template pattern (for template resources) */
  templatePattern?: string;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Parse URI template and extract parameter names.
 */
function parseUriTemplate(template: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = template.replace(/\{(\w+)\}/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/**
 * Match a URI against a template and extract parameters.
 */
function matchUriTemplate(uri: string, template: string): Record<string, string> | null {
  const { pattern, paramNames } = parseUriTemplate(template);
  const match = uri.match(pattern);

  if (!match) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]] = match[i + 1];
  }

  return params;
}

/**
 * Default serializer.
 */
function defaultSerialize(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Create MCP resources from a schema store.
 *
 * @param store - The schema store
 * @param options - Resource generation options
 * @returns Array of resource definitions
 */
export function createSchemaStoreResources<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
>(
  store: SchemaStore<T, TActions, TComputed>,
  options: SchemaStoreResourcesOptions<T, TComputed> = {},
): SchemaStoreResource[] {
  const {
    includeMain = true,
    includeKeys = true,
    includeComputed = true,
    keyConfigs = {} as { [K in keyof T]?: StoreResourceConfig<T[K]> },
    computedConfigs = {} as { [K in keyof TComputed]?: StoreResourceConfig<ComputedValues<T, TComputed>[K]> },
    templates = {},
    uriPrefix = 'store://',
    subscribeAll = false,
  } = options;

  const resources: SchemaStoreResource[] = [];

  // Main state resource
  if (includeMain) {
    const uri = `${uriPrefix}${store.name}`;
    resources.push({
      uri,
      name: `${store.name} State`,
      description: `Complete state of ${store.name} store`,
      mimeType: 'application/json',
      storeName: store.name,
      resourceType: 'main',
      handler: () => ({
        uri,
        mimeType: 'application/json',
        text: defaultSerialize(store.getSnapshot()),
      }),
    });
  }

  // Key resources
  if (includeKeys !== false) {
    const currentState = store.getSnapshot();
    const keysToInclude = Array.isArray(includeKeys)
      ? includeKeys
      : (Object.keys(currentState as object) as (keyof T)[]);

    for (const key of keysToInclude) {
      const keyStr = String(key);
      const config = (keyConfigs as Record<string, StoreResourceConfig<unknown> | undefined>)[keyStr] ?? {};
      const uri = `${uriPrefix}${store.name}/${keyStr}`;

      resources.push({
        uri,
        name: config.name ?? `${store.name} ${keyStr}`,
        description: config.description ?? `${keyStr} from ${store.name} store`,
        mimeType: config.mimeType ?? 'application/json',
        storeName: store.name,
        resourceType: 'key',
        keyName: keyStr,
        handler: () => {
          const state = store.getSnapshot();
          const data = state[key];
          const transformed = config.selector ? config.selector(data) : data;
          const text = config.serialize ? config.serialize(transformed) : defaultSerialize(transformed);

          return {
            uri,
            mimeType: config.mimeType ?? 'application/json',
            text,
          };
        },
      });
    }
  }

  // Computed value resources
  if (includeComputed !== false && store.computed) {
    const computedKeys = Array.isArray(includeComputed)
      ? includeComputed
      : (Object.keys(store.computed) as (keyof TComputed)[]);

    for (const key of computedKeys) {
      const keyStr = String(key);
      const config = (computedConfigs as Record<string, StoreResourceConfig<unknown> | undefined>)?.[keyStr] ?? {};
      const uri = `${uriPrefix}${store.name}/computed/${keyStr}`;

      resources.push({
        uri,
        name: config.name ?? `${store.name} ${keyStr} (computed)`,
        description: config.description ?? `Computed ${keyStr} from ${store.name} store`,
        mimeType: config.mimeType ?? 'application/json',
        storeName: store.name,
        resourceType: 'computed',
        keyName: keyStr,
        handler: () => {
          const computed = store.computed as Record<string, unknown>;
          const data = computed[keyStr];
          const transformed = config.selector ? (config.selector as (data: unknown) => unknown)(data) : data;
          const text = config.serialize
            ? (config.serialize as (data: unknown) => string)(transformed)
            : defaultSerialize(transformed);

          return {
            uri,
            mimeType: config.mimeType ?? 'application/json',
            text,
          };
        },
      });
    }
  }

  // Template resources
  for (const [templateUri, config] of Object.entries(templates)) {
    resources.push({
      uri: templateUri,
      name: config.name,
      description: config.description ?? `Template resource for ${store.name}`,
      mimeType: config.mimeType ?? 'application/json',
      storeName: store.name,
      resourceType: 'template',
      templatePattern: templateUri,
      handler: () => {
        // Template resources need the actual URI at runtime
        // This handler is for the template definition itself
        return {
          uri: templateUri,
          mimeType: config.mimeType ?? 'application/json',
          text: JSON.stringify({
            template: templateUri,
            description: config.description,
          }),
        };
      },
    });
  }

  return resources;
}

/**
 * Create a dynamic resource handler for template URIs.
 *
 * This returns a function that can handle any URI matching the template.
 *
 * @param store - The schema store
 * @param templateUri - The URI template (e.g., 'store://todos/item/{id}')
 * @param config - Template configuration
 * @returns A handler function for matching URIs
 */
export function createTemplateResourceHandler<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
>(
  store: SchemaStore<T, TActions, TComputed>,
  templateUri: string,
  config: TemplateResourceConfig<T>,
): (uri: string) => { uri: string; mimeType: string; text: string } | null {
  return (uri: string) => {
    const params = matchUriTemplate(uri, templateUri);
    if (!params) {
      return null;
    }

    const state = store.getSnapshot();
    const data = config.selector(state, params);

    if (data === undefined) {
      return null;
    }

    const text = config.serialize ? config.serialize(data) : defaultSerialize(data);

    return {
      uri,
      mimeType: config.mimeType ?? 'application/json',
      text,
    };
  };
}

/**
 * Create a single resource from a store with custom selector.
 *
 * @param store - The MCP store
 * @param uri - Resource URI
 * @param config - Resource configuration
 * @returns A resource definition
 */
export function createStoreSnapshotResource<T extends object, R = T>(
  store: McpStore<T>,
  uri: string,
  config: StoreResourceConfig<T, R> & { name: string },
): ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  const { name, description, selector, serialize, mimeType = 'application/json' } = config;

  return {
    uri,
    name,
    description,
    mimeType,
    handler: () => {
      const state = store.getSnapshot();
      const data = selector ? selector(state) : (state as unknown as R);
      const text = serialize ? serialize(data) : defaultSerialize(data);

      return { uri, mimeType, text };
    },
  };
}

/**
 * Create resources for a nested path in the store.
 *
 * @param store - The schema store
 * @param basePath - Base URI path
 * @param statePath - Dot-separated path in state
 * @param config - Resource configuration
 * @returns Array of resource definitions for the path and its children
 */
export function createNestedResources<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
>(
  store: SchemaStore<T, TActions, TComputed>,
  basePath: string,
  statePath: string,
  config: {
    maxDepth?: number;
    includeArrayItems?: boolean;
  } = {},
): ScopeResourceDefinition[] {
  const { maxDepth = 3, includeArrayItems = false } = config;
  const resources: ScopeResourceDefinition[] = [];

  function getValueAtPath(obj: unknown, path: string[]): unknown {
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  function traverse(obj: unknown, currentPath: string[], depth: number): void {
    if (depth > maxDepth || obj === null || obj === undefined) {
      return;
    }

    const uri = `${basePath}${currentPath.length > 0 ? '/' + currentPath.join('/') : ''}`;
    const pathStr = currentPath.join('/') || 'root';

    resources.push({
      uri,
      name: `${store.name} ${pathStr}`,
      description: `${pathStr} from ${store.name} store`,
      mimeType: 'application/json',
      handler: () => {
        const state = store.getSnapshot();
        const pathParts = statePath ? statePath.split('.') : [];
        const fullPath = [...pathParts, ...currentPath];
        const value = getValueAtPath(state, fullPath);

        return {
          uri,
          mimeType: 'application/json',
          text: defaultSerialize(value),
        };
      },
    });

    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj) && includeArrayItems) {
        for (let i = 0; i < obj.length; i++) {
          traverse(obj[i], [...currentPath, String(i)], depth + 1);
        }
      } else if (!Array.isArray(obj)) {
        for (const [key, value] of Object.entries(obj)) {
          traverse(value, [...currentPath, key], depth + 1);
        }
      }
    }
  }

  const state = store.getSnapshot();
  const pathParts = statePath ? statePath.split('.') : [];
  const rootValue = getValueAtPath(state, pathParts);
  traverse(rootValue, [], 0);

  return resources;
}
