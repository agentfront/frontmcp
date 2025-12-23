// file: libs/browser/src/store/schema-store-tools.ts
/**
 * Schema Store Tools - Advanced tool generation from schema stores.
 *
 * Provides utilities for generating MCP tools from schema store actions
 * with full Zod schema support for input/output validation.
 *
 * @example Basic usage
 * ```typescript
 * import { defineStore } from '@frontmcp/browser';
 * import { createSchemaStoreTools } from '@frontmcp/browser';
 *
 * const store = defineStore({
 *   name: 'counter',
 *   schema: z.object({ count: z.number() }),
 *   actions: {
 *     increment: (ctx, input: { amount: number }) => {
 *       ctx.state.count += input.amount;
 *     },
 *   },
 * });
 *
 * // Create tools with full schema metadata
 * const tools = createSchemaStoreTools(store, {
 *   increment: {
 *     description: 'Increment the counter',
 *     inputSchema: z.object({ amount: z.number().default(1) }),
 *   },
 * });
 *
 * // Register with scope
 * for (const tool of tools) {
 *   scope.registerTool(tool);
 * }
 * ```
 *
 * @example With annotations
 * ```typescript
 * // Using the @Action decorator pattern
 * const store = defineStore({
 *   name: 'users',
 *   schema: userSchema,
 *   actions: {
 *     createUser: action({
 *       description: 'Create a new user',
 *       input: z.object({
 *         name: z.string().min(1),
 *         email: z.string().email(),
 *       }),
 *       output: z.object({
 *         id: z.string(),
 *         success: z.boolean(),
 *       }),
 *     }, (ctx, input) => {
 *       const id = ctx.generateId();
 *       ctx.state.users.push({ id, ...input });
 *       return { id, success: true };
 *     }),
 *   },
 * });
 * ```
 */

import type { ZodType, ZodObject, ZodRawShape, z } from 'zod';
import type { SchemaStore, StoreActions, ComputedDefs, StoreAction, StoreActionContext } from './schema-store';
import type { ScopeToolDefinition } from '../scope/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Tool configuration for an action.
 */
export interface ActionToolConfig {
  /** Tool description */
  description?: string;

  /** Zod input schema (for validation and JSON Schema generation) */
  inputSchema?: ZodType<unknown>;

  /** Zod output schema (for validation) */
  outputSchema?: ZodType<unknown>;

  /** Custom tool name (default: {storeName}:{actionName}) */
  toolName?: string;

  /** Whether to validate input against schema (default: true) */
  validateInput?: boolean;

  /** Whether to validate output against schema (default: false) */
  validateOutput?: boolean;

  /** Risk level for HiTL (optional) */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Mark action as requiring confirmation */
  requiresConfirmation?: boolean;
}

/**
 * Tool configuration map for all actions.
 */
export type ActionToolConfigs<TActions extends StoreActions<object>> = {
  [K in keyof TActions]?: ActionToolConfig;
};

/**
 * Generated tool with full metadata.
 */
export interface SchemaStoreTool<TInput = unknown, TOutput = unknown> extends ScopeToolDefinition<TInput, TOutput> {
  /** Original action name */
  actionName: string;

  /** Store name */
  storeName: string;

  /** Risk level */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Requires confirmation */
  requiresConfirmation?: boolean;
}

/**
 * Action annotation - used to add metadata inline with action definitions.
 */
export interface ActionAnnotation<TInput, TOutput> {
  description?: string;
  input?: ZodType<TInput>;
  output?: ZodType<TOutput>;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation?: boolean;
}

/**
 * Annotated action - action with metadata attached.
 */
export interface AnnotatedAction<T extends object, TInput, TOutput> extends StoreAction<T, TInput, TOutput> {
  __actionMeta: ActionAnnotation<TInput, TOutput>;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if an action has annotations.
 */
function isAnnotatedAction<T extends object, TInput, TOutput>(
  action: StoreAction<T, TInput, TOutput>,
): action is AnnotatedAction<T, TInput, TOutput> {
  return '__actionMeta' in action;
}

/**
 * Convert Zod schema to JSON Schema (simplified).
 */
function zodToJsonSchema(schema: ZodType<unknown>): unknown {
  try {
    // Check if zod-to-json-schema is available
    if ('_def' in schema && typeof schema._def === 'object') {
      const def = schema._def as {
        typeName?: string;
        shape?: () => Record<string, ZodType<unknown>>;
        values?: unknown[];
        innerType?: ZodType<unknown>;
      };
      const typeName = def.typeName;

      switch (typeName) {
        case 'ZodString':
          return { type: 'string' };
        case 'ZodNumber':
          return { type: 'number' };
        case 'ZodBoolean':
          return { type: 'boolean' };
        case 'ZodArray':
          return {
            type: 'array',
            items: def.innerType ? zodToJsonSchema(def.innerType) : {},
          };
        case 'ZodObject':
          const shape = typeof def.shape === 'function' ? def.shape() : {};
          const properties: Record<string, unknown> = {};
          const required: string[] = [];

          for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodToJsonSchema(value as ZodType<unknown>);
            // Check if required (not optional)
            const valueDef = (value as ZodType<unknown>)._def as { typeName?: string } | undefined;
            if (valueDef?.typeName !== 'ZodOptional' && valueDef?.typeName !== 'ZodDefault') {
              required.push(key);
            }
          }

          return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
          };
        case 'ZodEnum':
          return {
            type: 'string',
            enum: def.values,
          };
        case 'ZodOptional':
          return def.innerType ? zodToJsonSchema(def.innerType) : {};
        case 'ZodDefault':
          return def.innerType ? zodToJsonSchema(def.innerType) : {};
        case 'ZodNullable':
          const inner = def.innerType ? zodToJsonSchema(def.innerType) : {};
          return { oneOf: [inner, { type: 'null' }] };
        default:
          return {};
      }
    }
  } catch {
    // Fallback to empty schema
  }
  return {};
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Create an annotated action with metadata.
 *
 * This allows adding schema and metadata directly to action definitions.
 *
 * @example
 * ```typescript
 * const store = defineStore({
 *   name: 'users',
 *   schema: z.object({ users: z.array(userSchema) }),
 *   actions: {
 *     createUser: action({
 *       description: 'Create a new user',
 *       input: z.object({ name: z.string(), email: z.string().email() }),
 *       output: z.object({ id: z.string() }),
 *       riskLevel: 'medium',
 *     }, (ctx, input) => {
 *       const id = ctx.generateId();
 *       ctx.state.users.push({ id, ...input });
 *       return { id };
 *     }),
 *   },
 * });
 * ```
 */
export function action<T extends object, TInput, TOutput>(
  annotation: ActionAnnotation<TInput, TOutput>,
  handler: StoreAction<T, TInput, TOutput>,
): AnnotatedAction<T, TInput, TOutput> {
  const annotated = handler as AnnotatedAction<T, TInput, TOutput>;
  annotated.__actionMeta = annotation;
  return annotated;
}

/**
 * Create MCP tools from a schema store's actions.
 *
 * @template T - State type
 * @template TActions - Actions type
 * @template TComputed - Computed type
 * @param store - The schema store
 * @param configs - Optional per-action configuration overrides
 * @returns Array of tool definitions ready for scope registration
 */
export function createSchemaStoreTools<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
>(
  store: SchemaStore<T, TActions, TComputed>,
  configs?: Partial<Record<keyof TActions, ActionToolConfig>>,
): SchemaStoreTool[] {
  const tools: SchemaStoreTool[] = [];
  const metadata = store.getActionMetadata();

  for (const meta of metadata) {
    const actionName = meta.actionName as keyof TActions;
    const config = configs?.[actionName] ?? {};

    // Get action function to check for annotations
    const actionFn = store.actions[actionName] as unknown;
    let annotation: ActionAnnotation<unknown, unknown> | undefined;

    // Check for inline annotations (from action() helper)
    if (
      typeof actionFn === 'function' &&
      isAnnotatedAction<T, unknown, unknown>(actionFn as StoreAction<T, unknown, unknown>)
    ) {
      annotation = (actionFn as AnnotatedAction<T, unknown, unknown>).__actionMeta;
    }

    // Merge annotation with config (config takes precedence)
    const description = config.description ?? annotation?.description ?? `Execute ${meta.actionName} on ${store.name}`;
    const inputSchema = config.inputSchema ?? annotation?.input;
    const outputSchema = config.outputSchema ?? annotation?.output;
    const riskLevel = config.riskLevel ?? annotation?.riskLevel;
    const requiresConfirmation = config.requiresConfirmation ?? annotation?.requiresConfirmation;
    const toolName = config.toolName ?? meta.fullName;

    // Build JSON Schema from Zod schema
    const jsonInputSchema = inputSchema ? zodToJsonSchema(inputSchema) : undefined;

    const tool: SchemaStoreTool = {
      name: toolName,
      description,
      actionName: meta.actionName,
      storeName: store.name,
      inputSchema: jsonInputSchema,
      riskLevel,
      requiresConfirmation,
      handler: (input: unknown) => {
        // Validate input if schema provided
        if (inputSchema && config.validateInput !== false) {
          const result = inputSchema.safeParse(input);
          if (!result.success) {
            throw new Error(`Invalid input: ${result.error.message}`);
          }
          input = result.data;
        }

        // Execute action
        const boundAction = store.actions[actionName] as (input?: unknown) => unknown;
        const output = boundAction(input);

        // Validate output if schema provided
        if (outputSchema && config.validateOutput) {
          if (output instanceof Promise) {
            return output.then((result) => {
              const parsed = outputSchema.safeParse(result);
              if (!parsed.success) {
                throw new Error(`Invalid output: ${parsed.error.message}`);
              }
              return parsed.data;
            });
          }

          const parsed = outputSchema.safeParse(output);
          if (!parsed.success) {
            throw new Error(`Invalid output: ${parsed.error.message}`);
          }
          return parsed.data;
        }

        return output;
      },
    };

    tools.push(tool);
  }

  return tools;
}

/**
 * Create a single tool from a store action.
 *
 * @param store - The schema store
 * @param actionName - The action name
 * @param config - Tool configuration
 * @returns A single tool definition
 */
export function createActionTool<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
  K extends keyof TActions & string,
>(store: SchemaStore<T, TActions, TComputed>, actionName: K, config?: ActionToolConfig): SchemaStoreTool {
  const configMap = { [actionName]: config } as Partial<Record<keyof TActions, ActionToolConfig>>;
  const tools = createSchemaStoreTools(store, configMap);
  return tools[0];
}

/**
 * Create tool definitions for batch operations.
 *
 * @param store - The schema store
 * @param options - Batch tool options
 * @returns A batch tool definition
 */
export function createBatchActionTool<
  T extends object,
  TActions extends StoreActions<T>,
  TComputed extends ComputedDefs<T>,
>(
  store: SchemaStore<T, TActions, TComputed>,
  options: {
    name?: string;
    description?: string;
    allowedActions?: (keyof TActions)[];
  } = {},
): ScopeToolDefinition<
  { operations: Array<{ action: string; input?: unknown }> },
  { success: boolean; results: unknown[] }
> {
  const {
    name = `${store.name}:batch`,
    description = `Execute multiple ${store.name} actions in a batch`,
    allowedActions,
  } = options;

  return {
    name,
    description,
    handler: (input: { operations: Array<{ action: string; input?: unknown }> }) => {
      const results: unknown[] = [];

      store.batch(() => {
        for (const op of input.operations) {
          // Check if action is allowed
          if (allowedActions && !allowedActions.includes(op.action as keyof TActions)) {
            throw new Error(`Action "${op.action}" is not allowed in batch`);
          }

          const action = store.actions[op.action as keyof TActions] as ((input?: unknown) => unknown) | undefined;
          if (!action) {
            throw new Error(`Action "${op.action}" not found`);
          }

          const result = action(op.input);
          results.push(result);
        }
      });

      return { success: true, results };
    },
  };
}
