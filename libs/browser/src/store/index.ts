// file: libs/browser/src/store/index.ts
/**
 * Valtio-based store layer for browser MCP server.
 *
 * Provides reactive state management using Valtio with MCP integration.
 *
 * ## Schema Store (Best DX)
 *
 * The recommended way to create stores is using `defineStore` which provides:
 * - Zod schema validation
 * - Full TypeScript inference (no manual types needed)
 * - Automatic MCP tool/resource generation
 * - Computed values with reactivity
 * - Persistence support
 *
 * @example
 * ```typescript
 * import { defineStore } from '@frontmcp/browser';
 * import { z } from 'zod';
 *
 * const todoStore = defineStore({
 *   name: 'todos',
 *   schema: z.object({
 *     items: z.array(z.object({
 *       id: z.string(),
 *       text: z.string(),
 *       completed: z.boolean(),
 *     })),
 *     filter: z.enum(['all', 'active', 'completed']),
 *   }),
 *   actions: {
 *     addTodo: (ctx, input: { text: string }) => {
 *       ctx.state.items.push({
 *         id: ctx.generateId(),
 *         text: input.text,
 *         completed: false,
 *       });
 *     },
 *     toggleTodo: (ctx, input: { id: string }) => {
 *       const item = ctx.state.items.find(i => i.id === input.id);
 *       if (item) item.completed = !item.completed;
 *     },
 *   },
 *   computed: {
 *     activeCount: (state) => state.items.filter(i => !i.completed).length,
 *   },
 * });
 *
 * // Use the store
 * todoStore.actions.addTodo({ text: 'Learn TypeScript' });
 * console.log(todoStore.computed.activeCount); // 1
 *
 * // Register with MCP scope
 * todoStore.registerWith(scope);
 * ```
 */

// =============================================================================
// Basic Store Types
// =============================================================================

export type {
  MutationOperation,
  StateChangeListener,
  KeyChangeListener,
  MutationListener,
  McpStore,
  McpStoreOptions,
  ComputedValue,
  McpStoreWithComputed,
  CreateMcpStore,
  StoreActions as BasicStoreActions,
  McpStoreWithActions,
} from './store.types';

// =============================================================================
// Basic Store Factory
// =============================================================================

export { createMcpStore, createAction, createAsyncAction, createComputed, createSelector } from './store.factory';

// =============================================================================
// Store Resource Integration
// =============================================================================

export { createStoreResource, createStoreResources, type StoreResourceOptions } from './store-resource';

// =============================================================================
// Store Tool Integration
// =============================================================================

export {
  createStoreSetTool,
  createStoreMutateTool,
  createStoreResetTool,
  createStoreBatchTool,
  type StoreSetToolOptions,
  type StoreMutateToolOptions,
} from './store-tool';

// =============================================================================
// Schema Store (Best DX) - Recommended API
// =============================================================================

export {
  // Main factory
  defineStore,
  deriveStore,

  // Types
  type SchemaStore,
  type SchemaStoreDefinition,
  type StoreActionContext,
  type StoreAction,
  type StoreActions,
  type BoundActions,
  type ComputedFn,
  type ComputedDefs,
  type ComputedValues,
  type ActionMetadata,
  type PersistConfig,
  type ScopeRegistration,
  type ActionInput,
  type ActionOutput,
} from './schema-store';

// =============================================================================
// Schema Store Tools
// =============================================================================

export {
  // Tool generation
  createSchemaStoreTools,
  createActionTool,
  createBatchActionTool,

  // Action annotation helper
  action,

  // Types
  type ActionToolConfig,
  type ActionToolConfigs,
  type SchemaStoreTool,
  type ActionAnnotation,
  type AnnotatedAction,
} from './schema-store-tools';

// =============================================================================
// Schema Store Resources
// =============================================================================

export {
  // Resource generation
  createSchemaStoreResources,
  createTemplateResourceHandler,
  createStoreSnapshotResource,
  createNestedResources,

  // Types
  type StoreResourceConfig,
  type TemplateResourceConfig,
  type SchemaStoreResourcesOptions,
  type SchemaStoreResource,
} from './schema-store-resources';

// =============================================================================
// Action Context
// =============================================================================

export {
  // Context factories
  createActionContext as createBaseActionContext,
  createExtendedActionContext,

  // Helpers
  createTypedAction,
  extendContext,

  // Types
  type ActionContext,
  type ExtendedActionContext,
  type ActionFn,
  type ExtendedActionFn,
  type CreateActionContextOptions,
} from './action-context';
