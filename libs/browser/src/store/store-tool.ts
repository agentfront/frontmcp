// file: libs/browser/src/store/store-tool.ts
/**
 * Store Tools - MCP tools for mutating Valtio store state.
 *
 * These tools allow MCP clients to modify the application state.
 *
 * @example
 * ```typescript
 * import { createMcpStore, createStoreSetTool, createStoreMutateTool } from '@frontmcp/browser';
 *
 * interface AppState {
 *   count: number;
 *   user: { name: string } | null;
 * }
 *
 * const store = createMcpStore<AppState>({
 *   initialState: { count: 0, user: null },
 * });
 *
 * // Create a tool that sets a specific key
 * const setCountTool = createStoreSetTool(store, {
 *   name: 'set-count',
 *   key: 'count',
 *   description: 'Set the count value',
 * });
 *
 * // Create a custom mutation tool
 * const incrementTool = createStoreMutateTool(store, {
 *   name: 'increment',
 *   description: 'Increment the count',
 *   mutate: (state, input: { amount?: number }) => {
 *     state.count += input.amount ?? 1;
 *   },
 * });
 *
 * // Register with scope
 * scope.registerTool(setCountTool);
 * scope.registerTool(incrementTool);
 * ```
 */

import type { McpStore } from './store.types';
import type { ScopeToolDefinition } from '../scope/types';

/**
 * Options for creating a store set tool.
 */
export interface StoreSetToolOptions<T extends object, K extends keyof T> {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** The key in the store to set */
  key: K;

  /**
   * Validate the input value before setting.
   * Return true if valid, false or error message if invalid.
   */
  validate?: (value: unknown) => boolean | string;

  /**
   * Transform the input before setting.
   */
  transform?: (value: unknown) => T[K];
}

/**
 * Options for creating a custom mutation tool.
 */
export interface StoreMutateToolOptions<T extends object, In = unknown, Out = unknown> {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /**
   * Input schema (for MCP tool definition).
   */
  inputSchema?: unknown;

  /**
   * Mutation function that modifies the store state.
   * The state object is reactive - mutations trigger updates.
   */
  mutate: (state: T, input: In) => Out | Promise<Out>;
}

/**
 * Create an MCP tool that sets a specific store key.
 *
 * @template T - The store state type
 * @template K - The key type
 * @param store - The MCP store
 * @param options - Tool options
 * @returns A ScopeToolDefinition compatible with BrowserScope
 */
export function createStoreSetTool<T extends object, K extends keyof T>(
  store: McpStore<T>,
  options: StoreSetToolOptions<T, K>,
): ScopeToolDefinition<{ value: unknown }, { success: boolean; key: string; previousValue: T[K] }> {
  const { name, description, key, validate, transform } = options;

  return {
    name,
    description,
    handler: (input: { value: unknown }) => {
      // Validate if provided
      if (validate) {
        const result = validate(input.value);
        if (result !== true) {
          throw new Error(typeof result === 'string' ? result : `Invalid value for ${String(key)}`);
        }
      }

      // Get previous value for response
      const previousValue = store.getSnapshot()[key];

      // Transform if provided
      const newValue = transform ? transform(input.value) : (input.value as T[K]);

      // Set the value
      store.state[key] = newValue;

      return {
        success: true,
        key: String(key),
        previousValue,
      };
    },
  };
}

/**
 * Create a custom MCP mutation tool.
 *
 * This allows defining custom mutation logic that operates on the store.
 *
 * @template T - The store state type
 * @template In - Input type
 * @template Out - Output type
 * @param store - The MCP store
 * @param options - Tool options
 * @returns A ScopeToolDefinition compatible with BrowserScope
 */
export function createStoreMutateTool<T extends object, In = unknown, Out = unknown>(
  store: McpStore<T>,
  options: StoreMutateToolOptions<T, In, Out>,
): ScopeToolDefinition<In, Out> {
  const { name, description, inputSchema, mutate } = options;

  return {
    name,
    description,
    inputSchema,
    handler: (input: In) => {
      return mutate(store.state, input);
    },
  };
}

/**
 * Create a tool that resets the store to initial state.
 *
 * @param store - The MCP store
 * @param options - Tool options
 * @returns A ScopeToolDefinition compatible with BrowserScope
 */
export function createStoreResetTool<T extends object>(
  store: McpStore<T>,
  options: {
    name?: string;
    description?: string;
  } = {},
): ScopeToolDefinition<Record<string, never>, { success: boolean }> {
  const { name = 'reset-state', description = 'Reset the store to initial state' } = options;

  return {
    name,
    description,
    handler: () => {
      store.reset();
      return { success: true };
    },
  };
}

/**
 * Create a batch mutation tool.
 *
 * Allows applying multiple mutations in a single call.
 *
 * @param store - The MCP store
 * @param options - Tool options including available mutations
 * @returns A ScopeToolDefinition compatible with BrowserScope
 */
export function createStoreBatchTool<T extends object>(
  store: McpStore<T>,
  options: {
    name?: string;
    description?: string;
    /** Available mutations by name */
    mutations: Record<string, (state: T, value: unknown) => void>;
  },
): ScopeToolDefinition<
  { operations: Array<{ mutation: string; value: unknown }> },
  { success: boolean; applied: number }
> {
  const { name = 'batch-mutate', description = 'Apply multiple mutations in a batch', mutations } = options;

  return {
    name,
    description,
    handler: (input: { operations: Array<{ mutation: string; value: unknown }> }) => {
      let applied = 0;

      store.batch((state) => {
        for (const op of input.operations) {
          const mutationFn = mutations[op.mutation];
          if (mutationFn) {
            mutationFn(state, op.value);
            applied++;
          }
        }
      });

      return { success: true, applied };
    },
  };
}
