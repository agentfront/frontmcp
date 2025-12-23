// file: libs/browser/src/store/schema-store.ts
/**
 * Schema Store - The best DX for building schema-driven Valtio stores.
 *
 * Combines Zod schema validation with Valtio reactivity and automatic MCP integration.
 *
 * @example Basic usage
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
 *     setFilter: (ctx, input: { filter: 'all' | 'active' | 'completed' }) => {
 *       ctx.state.filter = input.filter;
 *     },
 *     clearCompleted: (ctx) => {
 *       ctx.state.items = ctx.state.items.filter(i => !i.completed);
 *     },
 *   },
 * });
 *
 * // Full TypeScript inference - no manual types needed!
 * todoStore.state.items[0].text; // string
 * todoStore.actions.addTodo({ text: 'Learn TypeScript' });
 *
 * // Register all tools/resources with MCP scope
 * todoStore.registerWith(scope);
 * ```
 *
 * @example With computed values
 * ```typescript
 * const cartStore = defineStore({
 *   name: 'cart',
 *   schema: z.object({
 *     items: z.array(z.object({
 *       id: z.string(),
 *       price: z.number(),
 *       quantity: z.number(),
 *     })),
 *     discount: z.number(),
 *   }),
 *   actions: {
 *     addItem: (ctx, input: { id: string; price: number }) => {
 *       const existing = ctx.state.items.find(i => i.id === input.id);
 *       if (existing) {
 *         existing.quantity++;
 *       } else {
 *         ctx.state.items.push({ id: input.id, price: input.price, quantity: 1 });
 *       }
 *     },
 *     removeItem: (ctx, input: { id: string }) => {
 *       ctx.state.items = ctx.state.items.filter(i => i.id !== input.id);
 *     },
 *   },
 *   computed: {
 *     subtotal: (state) => state.items.reduce((sum, i) => sum + i.price * i.quantity, 0),
 *     total: (state, computed) => computed.subtotal * (1 - state.discount),
 *     itemCount: (state) => state.items.reduce((sum, i) => sum + i.quantity, 0),
 *   },
 * });
 *
 * cartStore.computed.total; // number - reactive!
 * ```
 */

import { proxy, snapshot, subscribe, ref } from 'valtio';
import { subscribeKey as valtioSubscribeKey } from 'valtio/utils';
import type { ZodType, ZodObject, ZodRawShape, infer as ZodInfer } from 'zod';
import { generateUUID } from '@frontmcp/sdk/core';
import type {
  McpStore,
  StateChangeListener,
  KeyChangeListener,
  MutationListener,
  MutationOperation,
} from './store.types';

// =============================================================================
// Types
// =============================================================================

/**
 * Action context provides utilities and state access for actions.
 */
export interface StoreActionContext<T extends object> {
  /** The mutable state proxy. Direct mutations trigger reactivity. */
  readonly state: T;

  /** Get an immutable snapshot of current state. Safe for async operations. */
  getSnapshot(): Readonly<T>;

  /** Generate a unique ID (UUID v4) */
  generateId(): string;

  /** Generate a short ID (8 chars) */
  generateShortId(): string;

  /** Get current timestamp (ISO string) */
  timestamp(): string;

  /** Get current Unix timestamp (ms) */
  now(): number;

  /** Call another action by name */
  call<K extends string>(actionName: K, input?: unknown): unknown;

  /** Batch multiple mutations (subscribers notified once at end) */
  batch(fn: (state: T) => void): void;
}

/**
 * Action function signature.
 */
export type StoreAction<T extends object, TInput = void, TOutput = void> = (
  ctx: StoreActionContext<T>,
  input: TInput,
) => TOutput | Promise<TOutput>;

/**
 * Actions definition - maps action names to action functions.
 */
export type StoreActions<T extends object> = {
  [K: string]: StoreAction<T, unknown, unknown>;
};

/**
 * Extract input type from an action.
 */
export type ActionInput<A> = A extends StoreAction<object, infer I, unknown> ? I : never;

/**
 * Extract output type from an action.
 */
export type ActionOutput<A> = A extends StoreAction<object, unknown, infer O> ? O : never;

/**
 * Bound actions - actions without the context parameter.
 */
export type BoundActions<T extends object, A extends StoreActions<T>> = {
  [K in keyof A]: A[K] extends StoreAction<T, infer I, infer O> ? (I extends void ? () => O : (input: I) => O) : never;
};

/**
 * Computed value function.
 */
export type ComputedFn<T extends object, C extends object, R> = (state: Readonly<T>, computed: C) => R;

/**
 * Computed definitions - maps names to computed functions.
 */
export type ComputedDefs<T extends object> = {
  [K: string]: ComputedFn<T, object, unknown>;
};

/**
 * Computed values result type.
 */
export type ComputedValues<T extends object, C extends ComputedDefs<T>> = {
  [K in keyof C]: C[K] extends ComputedFn<T, object, infer R> ? R : never;
};

/**
 * Schema store definition options.
 */
export interface SchemaStoreDefinition<
  TSchema extends ZodObject<ZodRawShape>,
  TActions extends StoreActions<ZodInfer<TSchema>>,
  TComputed extends ComputedDefs<ZodInfer<TSchema>> = Record<string, never>,
> {
  /** Store name - used for tool/resource naming */
  name: string;

  /** Zod schema defining the state shape */
  schema: TSchema;

  /** Initial state (optional - uses schema defaults if not provided) */
  initialState?: Partial<ZodInfer<TSchema>>;

  /** Store actions */
  actions: TActions;

  /** Computed values (optional) */
  computed?: TComputed;

  /** Enable development mode logging */
  devMode?: boolean;

  /** Persistence configuration */
  persist?: boolean | string | PersistConfig;
}

/**
 * Persistence configuration.
 */
export interface PersistConfig {
  /** Storage key */
  key: string;

  /** Storage type: 'local' | 'session' | 'indexed-db' */
  storage?: 'local' | 'session' | 'indexed-db';

  /** Paths to include in persistence (default: all) */
  include?: string[];

  /** Paths to exclude from persistence */
  exclude?: string[];

  /** Debounce time in ms (default: 100) */
  debounce?: number;

  /** Version for migrations */
  version?: number;

  /** Migration function */
  migrate?: (persisted: unknown, version: number) => unknown;
}

/**
 * The schema store instance - combines McpStore with typed actions and computed.
 */
export interface SchemaStore<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T> = Record<string, never>,
> extends McpStore<T> {
  /** Store name */
  readonly name: string;

  /** The Zod schema */
  readonly schema: ZodType<T>;

  /** Bound action methods */
  readonly actions: BoundActions<T, TActions>;

  /** Computed values (reactive) */
  readonly computed: ComputedValues<T, TComputed>;

  /** Get action metadata for MCP tool generation */
  getActionMetadata(): ActionMetadata[];

  /** Register all tools and resources with a scope */
  registerWith(scope: ScopeRegistration): void;

  /** Validate state against schema */
  validate(): { success: true; data: T } | { success: false; error: Error };

  /** Dispose of the store and clean up subscriptions */
  dispose(): void;
}

/**
 * Action metadata for tool generation.
 */
export interface ActionMetadata {
  name: string;
  actionName: string;
  fullName: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  isAsync: boolean;
}

/**
 * Minimal scope interface for registration.
 */
export interface ScopeRegistration {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema?: unknown;
    handler: (input: unknown) => unknown;
  }): void;
  registerResource(resource: {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    handler: () => unknown;
  }): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Extract default values from a Zod schema.
 */
function extractDefaults<T extends ZodObject<ZodRawShape>>(schema: T): Partial<ZodInfer<T>> {
  const defaults: Record<string, unknown> = {};

  try {
    const shape = schema.shape;
    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as ZodType<unknown>;
      // Check if schema has a default
      if ('_def' in fieldSchema && typeof fieldSchema._def === 'object' && fieldSchema._def !== null) {
        const def = fieldSchema._def as { defaultValue?: () => unknown };
        if (typeof def.defaultValue === 'function') {
          defaults[key] = def.defaultValue();
        }
      }
    }
  } catch {
    // Schema introspection failed, return empty defaults
  }

  return defaults as Partial<ZodInfer<T>>;
}

/**
 * Check if a function is async.
 */
function isAsyncFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  return fn.constructor.name === 'AsyncFunction';
}

/**
 * Create the action context for an action execution.
 */
function createActionContext<T extends object>(
  state: T,
  storeRef: { store: SchemaStore<T, StoreActions<T>, ComputedDefs<T>> | null },
  batch: (fn: (state: T) => void) => void,
): StoreActionContext<T> {
  return {
    get state() {
      return state;
    },

    getSnapshot(): Readonly<T> {
      return snapshot(state) as Readonly<T>;
    },

    generateId(): string {
      return generateUUID();
    },

    generateShortId(): string {
      return generateUUID().slice(0, 8);
    },

    timestamp(): string {
      return new Date().toISOString();
    },

    now(): number {
      return Date.now();
    },

    call<K extends string>(actionName: K, input?: unknown): unknown {
      if (!storeRef.store) {
        throw new Error('Store not initialized');
      }
      const actions = storeRef.store.actions as Record<string, (input?: unknown) => unknown>;
      const action = actions[actionName];
      if (!action) {
        throw new Error(`Action "${actionName}" not found`);
      }
      return action(input);
    },

    batch(fn: (state: T) => void): void {
      batch(fn);
    },
  };
}

/**
 * Define a schema-driven store with the best DX.
 *
 * @template TSchema - The Zod schema type
 * @template TActions - The actions type
 * @template TComputed - The computed values type
 * @param definition - The store definition
 * @returns A fully typed schema store
 */
export function defineStore<
  TSchema extends ZodObject<ZodRawShape>,
  TActions extends StoreActions<ZodInfer<TSchema>>,
  TComputed extends ComputedDefs<ZodInfer<TSchema>> = Record<string, never>,
>(
  definition: SchemaStoreDefinition<TSchema, TActions, TComputed>,
): SchemaStore<ZodInfer<TSchema>, TActions, TComputed> {
  type T = ZodInfer<TSchema>;

  const {
    name,
    schema,
    initialState: providedInitial,
    actions: actionDefs,
    computed: computedDefs,
    devMode = false,
    persist,
  } = definition;

  // Extract defaults and merge with provided initial state
  const schemaDefaults = extractDefaults(schema);
  const initialState = { ...schemaDefaults, ...providedInitial } as T;

  // Validate initial state
  const parseResult = schema.safeParse(initialState);
  if (!parseResult.success) {
    throw new Error(`Invalid initial state for store "${name}": ${parseResult.error.message}`);
  }

  // Create Valtio proxy
  const state = proxy<T>(JSON.parse(JSON.stringify(parseResult.data)) as T);

  // Store the original for reset
  const savedInitialState = JSON.parse(JSON.stringify(parseResult.data)) as T;

  // Mutation listeners
  const mutationListeners = new Set<MutationListener>();
  const disposeCallbacks: Array<() => void> = [];

  // Batching state
  let isBatching = false;
  let batchedOps: MutationOperation[] = [];

  // Create batch function
  const batch = (fn: (s: T) => void): void => {
    isBatching = true;
    batchedOps = [];

    try {
      fn(state);
    } finally {
      isBatching = false;

      if (batchedOps.length > 0) {
        for (const listener of mutationListeners) {
          try {
            listener(batchedOps);
          } catch (error) {
            if (devMode) {
              console.error(`[Schema Store - ${name}] Mutation listener error:`, error);
            }
          }
        }
      }
      batchedOps = [];
    }
  };

  // Reference for action context (to allow ctx.call)
  const storeRef: { store: SchemaStore<T, TActions, TComputed> | null } = { store: null };

  // Create bound actions
  const boundActions = {} as BoundActions<T, TActions>;
  const actionMetadata: ActionMetadata[] = [];

  for (const [actionName, actionFn] of Object.entries(actionDefs)) {
    const isAsync = isAsyncFunction(actionFn);
    const fullName = `${name}:${actionName}`;

    // Create bound action
    (boundActions as Record<string, unknown>)[actionName] = (input?: unknown) => {
      const ctx = createActionContext<T>(state, storeRef, batch);
      const result = (actionFn as StoreAction<T, unknown, unknown>)(ctx, input);

      if (devMode) {
        console.log(`[Schema Store - ${name}] Action: ${actionName}`, {
          input,
          result: result instanceof Promise ? '<Promise>' : result,
        });
      }

      return result;
    };

    // Collect metadata
    actionMetadata.push({
      name: actionName,
      actionName,
      fullName,
      isAsync,
    });
  }

  // Create computed values
  const computedValues = {} as ComputedValues<T, TComputed>;

  if (computedDefs) {
    for (const [computedName, computedFn] of Object.entries(computedDefs)) {
      // Use a getter for lazy/reactive computation
      Object.defineProperty(computedValues, computedName, {
        get: () => {
          const currentSnapshot = snapshot(state) as Readonly<T>;
          return (computedFn as ComputedFn<T, typeof computedValues, unknown>)(currentSnapshot, computedValues);
        },
        enumerable: true,
      });
    }
  }

  // Dev mode logging
  if (devMode) {
    const unsub = subscribe(state, () => {
      console.log(`[Schema Store - ${name}] State changed:`, snapshot(state));
    });
    disposeCallbacks.push(unsub);
  }

  // Handle persistence
  if (persist) {
    const persistConfig: PersistConfig =
      typeof persist === 'boolean'
        ? { key: `schema-store:${name}` }
        : typeof persist === 'string'
        ? { key: persist }
        : persist;

    // Load persisted state
    try {
      const storage = persistConfig.storage === 'session' ? sessionStorage : localStorage;
      const stored = storage.getItem(persistConfig.key);
      if (stored) {
        let persisted = JSON.parse(stored) as { data: unknown; version?: number };
        let data = persisted.data;

        // Run migration if needed
        if (persistConfig.migrate && persistConfig.version !== undefined) {
          const storedVersion = persisted.version ?? 0;
          if (storedVersion < persistConfig.version) {
            data = persistConfig.migrate(data, storedVersion);
          }
        }

        // Merge persisted data
        if (data && typeof data === 'object') {
          const merged = { ...state, ...(data as object) } as T;
          const validResult = schema.safeParse(merged);
          if (validResult.success) {
            Object.assign(state, validResult.data);
          }
        }
      }
    } catch {
      // Ignore load errors
    }

    // Set up persistence subscription
    let persistTimeout: ReturnType<typeof setTimeout> | null = null;
    const debouncePersist = persistConfig.debounce ?? 100;

    const unsub = subscribe(state, () => {
      if (persistTimeout) clearTimeout(persistTimeout);

      persistTimeout = setTimeout(() => {
        try {
          const storage = persistConfig.storage === 'session' ? sessionStorage : localStorage;
          const data = snapshot(state) as T;

          // Apply include/exclude filters
          let persistData: Record<string, unknown> = data as unknown as Record<string, unknown>;
          if (persistConfig.include || persistConfig.exclude) {
            persistData = {};
            for (const key of Object.keys(data as object)) {
              const include = !persistConfig.include || persistConfig.include.includes(key);
              const exclude = persistConfig.exclude?.includes(key);
              if (include && !exclude) {
                persistData[key] = (data as Record<string, unknown>)[key];
              }
            }
          }

          storage.setItem(
            persistConfig.key,
            JSON.stringify({
              data: persistData,
              version: persistConfig.version,
            }),
          );
        } catch {
          // Ignore save errors
        }
      }, debouncePersist);
    });

    disposeCallbacks.push(() => {
      unsub();
      if (persistTimeout) clearTimeout(persistTimeout);
    });
  }

  // Build the store object
  const store: SchemaStore<T, TActions, TComputed> = {
    name,
    schema: schema as unknown as ZodType<T>,

    get state() {
      return state;
    },

    actions: boundActions,
    computed: computedValues,

    getSnapshot(): Readonly<T> {
      return snapshot(state) as Readonly<T>;
    },

    subscribe(listener: StateChangeListener<T>): () => void {
      let previousSnapshot = snapshot(state) as T;

      const unsub = subscribe(state, () => {
        const currentSnapshot = snapshot(state) as T;
        try {
          listener(currentSnapshot, previousSnapshot);
        } finally {
          previousSnapshot = currentSnapshot;
        }
      });

      return unsub;
    },

    subscribeKey<K extends keyof T>(key: K, listener: KeyChangeListener<T[K]>): () => void {
      return valtioSubscribeKey(state, key, (value: T[K]) => {
        listener(value, value);
      });
    },

    onMutation(listener: MutationListener): () => void {
      mutationListeners.add(listener);
      return () => {
        mutationListeners.delete(listener);
      };
    },

    reset(newInitialState?: Partial<T>): void {
      const resetState = newInitialState ? { ...savedInitialState, ...newInitialState } : savedInitialState;

      for (const key of Object.keys(resetState) as (keyof T)[]) {
        (state as T)[key] = JSON.parse(JSON.stringify(resetState[key]));
      }

      for (const key of Object.keys(state) as (keyof T)[]) {
        if (!(key in resetState)) {
          delete (state as T)[key];
        }
      }
    },

    batch,

    getActionMetadata(): ActionMetadata[] {
      return [...actionMetadata];
    },

    registerWith(scope: ScopeRegistration): void {
      // Register tools for each action
      for (const meta of actionMetadata) {
        scope.registerTool({
          name: meta.fullName,
          description: `Execute ${meta.actionName} action on ${name} store`,
          handler: (input: unknown) => {
            const action = (boundActions as Record<string, (input?: unknown) => unknown>)[meta.actionName];
            return action(input);
          },
        });
      }

      // Register main state resource
      scope.registerResource({
        uri: `store://${name}`,
        name: `${name} State`,
        description: `Current state of ${name} store`,
        mimeType: 'application/json',
        handler: () => ({
          uri: `store://${name}`,
          mimeType: 'application/json',
          text: JSON.stringify(snapshot(state), null, 2),
        }),
      });

      // Register resources for each top-level key
      for (const key of Object.keys(state)) {
        scope.registerResource({
          uri: `store://${name}/${key}`,
          name: `${name} ${key}`,
          description: `${key} from ${name} store`,
          mimeType: 'application/json',
          handler: () => ({
            uri: `store://${name}/${key}`,
            mimeType: 'application/json',
            text: JSON.stringify((snapshot(state) as Record<string, unknown>)[key], null, 2),
          }),
        });
      }

      // Register computed values as resources
      if (computedDefs) {
        for (const computedName of Object.keys(computedDefs)) {
          scope.registerResource({
            uri: `store://${name}/computed/${computedName}`,
            name: `${name} ${computedName} (computed)`,
            description: `Computed ${computedName} from ${name} store`,
            mimeType: 'application/json',
            handler: () => ({
              uri: `store://${name}/computed/${computedName}`,
              mimeType: 'application/json',
              text: JSON.stringify((computedValues as Record<string, unknown>)[computedName], null, 2),
            }),
          });
        }
      }
    },

    validate(): { success: true; data: T } | { success: false; error: Error } {
      const result = schema.safeParse(snapshot(state));
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false, error: new Error(result.error.message) };
    },

    dispose(): void {
      for (const callback of disposeCallbacks) {
        callback();
      }
      disposeCallbacks.length = 0;
      mutationListeners.clear();
    },
  };

  // Set store reference for ctx.call
  storeRef.store = store;

  return store;
}

/**
 * Create a derived store that depends on another store.
 *
 * @example
 * ```typescript
 * const filteredTodosStore = deriveStore(todoStore, {
 *   name: 'filtered-todos',
 *   derive: (state) => ({
 *     items: state.filter === 'all'
 *       ? state.items
 *       : state.filter === 'active'
 *         ? state.items.filter(i => !i.completed)
 *         : state.items.filter(i => i.completed),
 *   }),
 * });
 * ```
 */
export function deriveStore<TSource extends object, TDerived extends object>(
  sourceStore: McpStore<TSource>,
  options: {
    name: string;
    derive: (source: Readonly<TSource>) => TDerived;
  },
): {
  name: string;
  state: Readonly<TDerived>;
  subscribe: (listener: (state: Readonly<TDerived>) => void) => () => void;
} {
  const { name, derive } = options;

  // Create derived state using getter
  const derivedProxy = {
    get state(): Readonly<TDerived> {
      return derive(sourceStore.getSnapshot());
    },
  };

  return {
    name,
    get state() {
      return derivedProxy.state;
    },
    subscribe(listener: (state: Readonly<TDerived>) => void): () => void {
      return sourceStore.subscribe(() => {
        listener(derivedProxy.state);
      });
    },
  };
}
