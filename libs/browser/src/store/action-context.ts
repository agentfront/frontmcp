// file: libs/browser/src/store/action-context.ts
/**
 * Store Action Context - Rich context for store action execution.
 *
 * Provides utilities, state access, and cross-action calling capabilities.
 *
 * @example Usage in actions
 * ```typescript
 * const store = defineStore({
 *   name: 'app',
 *   schema: z.object({ ... }),
 *   actions: {
 *     doSomething: (ctx, input: { value: string }) => {
 *       // Access reactive state
 *       ctx.state.myField = input.value;
 *
 *       // Get immutable snapshot (safe for async)
 *       const current = ctx.getSnapshot();
 *
 *       // Generate unique IDs
 *       const id = ctx.generateId(); // UUID v4
 *       const shortId = ctx.generateShortId(); // 8 chars
 *
 *       // Get timestamps
 *       const iso = ctx.timestamp(); // ISO string
 *       const ms = ctx.now(); // Unix ms
 *
 *       // Batch multiple mutations
 *       ctx.batch((state) => {
 *         state.a = 1;
 *         state.b = 2;
 *         state.c = 3;
 *       });
 *
 *       // Call another action
 *       ctx.call('otherAction', { data: 'value' });
 *     },
 *   },
 * });
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Base action context interface.
 *
 * This is the context passed to every store action.
 */
export interface ActionContext<T extends object> {
  /**
   * The mutable state proxy.
   *
   * Direct mutations to this object trigger Valtio reactivity.
   * All subscribers and React components using `useSnapshot` will update.
   *
   * @example
   * ```typescript
   * // Direct mutations work
   * ctx.state.count = 10;
   * ctx.state.items.push({ id: '1', name: 'New' });
   * ctx.state.user = { name: 'John' };
   * ```
   */
  readonly state: T;

  /**
   * Get an immutable snapshot of current state.
   *
   * Use this for:
   * - Safe reads in async operations
   * - Passing state to external APIs
   * - Comparing before/after states
   *
   * @example
   * ```typescript
   * const before = ctx.getSnapshot();
   * ctx.state.count++;
   * const after = ctx.getSnapshot();
   * console.log(before.count, after.count); // Different values
   * ```
   */
  getSnapshot(): Readonly<T>;

  /**
   * Generate a UUID v4.
   *
   * Uses Web Crypto API for secure random generation.
   *
   * @returns A UUID string like '550e8400-e29b-41d4-a716-446655440000'
   */
  generateId(): string;

  /**
   * Generate a short ID (8 characters).
   *
   * First 8 characters of a UUID. Good for display IDs.
   *
   * @returns An 8-character string like '550e8400'
   */
  generateShortId(): string;

  /**
   * Get current timestamp as ISO string.
   *
   * @returns ISO 8601 string like '2024-01-15T10:30:00.000Z'
   */
  timestamp(): string;

  /**
   * Get current Unix timestamp in milliseconds.
   *
   * @returns Number like 1705314600000
   */
  now(): number;

  /**
   * Call another action by name.
   *
   * Enables composition of actions within the same store.
   *
   * @param actionName - The action to call
   * @param input - Optional input for the action
   * @returns The action's return value
   *
   * @example
   * ```typescript
   * // In an action
   * ctx.call('resetCount'); // Call action without input
   * ctx.call('setUser', { name: 'John' }); // With input
   * const result = ctx.call('fetchData', { id: '123' }); // With return
   * ```
   */
  call<K extends string>(actionName: K, input?: unknown): unknown;

  /**
   * Batch multiple mutations.
   *
   * All mutations inside the batch function are applied,
   * but subscribers are only notified once at the end.
   *
   * Use this for:
   * - Setting multiple related fields atomically
   * - Bulk updates to arrays
   * - Complex state transitions
   *
   * @param fn - Function that performs mutations on state
   *
   * @example
   * ```typescript
   * ctx.batch((state) => {
   *   state.loading = false;
   *   state.data = fetchedData;
   *   state.lastUpdated = Date.now();
   *   state.error = null;
   * });
   * // Subscribers notified once with all changes
   * ```
   */
  batch(fn: (state: T) => void): void;
}

/**
 * Extended action context with additional capabilities.
 */
export interface ExtendedActionContext<T extends object> extends ActionContext<T> {
  /**
   * Store name.
   */
  readonly storeName: string;

  /**
   * Mark the action as having side effects.
   *
   * Useful for logging, auditing, or HiTL.
   */
  markSideEffect(description: string): void;

  /**
   * Log a message with store context.
   *
   * @param level - Log level
   * @param message - Log message
   * @param data - Optional data to include
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}

/**
 * Action function type.
 */
export type ActionFn<T extends object, TInput = void, TOutput = void> = (
  ctx: ActionContext<T>,
  input: TInput,
) => TOutput | Promise<TOutput>;

/**
 * Extended action function type.
 */
export type ExtendedActionFn<T extends object, TInput = void, TOutput = void> = (
  ctx: ExtendedActionContext<T>,
  input: TInput,
) => TOutput | Promise<TOutput>;

// =============================================================================
// Factories
// =============================================================================

/**
 * Options for creating an action context.
 */
export interface CreateActionContextOptions<T extends object> {
  /** The reactive state proxy */
  state: T;

  /** Function to get immutable snapshot */
  getSnapshot: () => Readonly<T>;

  /** Batch function for grouping mutations */
  batch: (fn: (state: T) => void) => void;

  /** Function to call other actions */
  callAction?: (name: string, input?: unknown) => unknown;

  /** Store name (for extended context) */
  storeName?: string;

  /** Logger (for extended context) */
  logger?: {
    debug: (message: string, data?: unknown) => void;
    info: (message: string, data?: unknown) => void;
    warn: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
}

/**
 * Create a basic action context.
 *
 * @param options - Context options
 * @returns An action context object
 */
export function createActionContext<T extends object>(options: CreateActionContextOptions<T>): ActionContext<T> {
  const { state, getSnapshot, batch, callAction } = options;

  return {
    get state() {
      return state;
    },

    getSnapshot,

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
      if (!callAction) {
        throw new Error('Action calling not supported in this context');
      }
      return callAction(actionName, input);
    },

    batch,
  };
}

/**
 * Create an extended action context with additional capabilities.
 *
 * @param options - Context options
 * @returns An extended action context object
 */
export function createExtendedActionContext<T extends object>(
  options: CreateActionContextOptions<T> & { storeName: string },
): ExtendedActionContext<T> {
  const base = createActionContext(options);
  const { storeName, logger } = options;
  const sideEffects: string[] = [];

  return {
    ...base,

    storeName,

    markSideEffect(description: string): void {
      sideEffects.push(description);
    },

    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
      const prefix = `[${storeName}]`;
      const fullMessage = `${prefix} ${message}`;

      if (logger) {
        logger[level](fullMessage, data);
      } else {
        const logFn = console[level] ?? console.log;
        if (data !== undefined) {
          logFn(fullMessage, data);
        } else {
          logFn(fullMessage);
        }
      }
    },
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a typed action helper for better DX.
 *
 * This helper provides a type-safe way to define actions with full inference.
 *
 * @example
 * ```typescript
 * const increment = createTypedAction<AppState, { amount: number }, void>()((ctx, input) => {
 *   ctx.state.count += input.amount;
 * });
 *
 * // Use in store definition
 * const store = defineStore({
 *   name: 'counter',
 *   schema: counterSchema,
 *   actions: { increment },
 * });
 * ```
 */
export function createTypedAction<T extends object, TInput = void, TOutput = void>() {
  return (fn: ActionFn<T, TInput, TOutput>): ActionFn<T, TInput, TOutput> => fn;
}

/**
 * Combine multiple action contexts into one.
 *
 * Useful for middleware-style patterns.
 *
 * @param base - Base context
 * @param extensions - Extensions to apply
 * @returns Extended context
 */
export function extendContext<T extends object>(
  base: ActionContext<T>,
  extensions: Partial<ActionContext<T>>,
): ActionContext<T> {
  return {
    ...base,
    ...extensions,
  };
}
