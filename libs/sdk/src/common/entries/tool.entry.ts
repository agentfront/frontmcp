// file: libs/sdk/src/common/entries/tool.entry.ts

import { toJSONSchema, z } from '@frontmcp/lazy-zod';
import {
  type AuthInfo,
  type CallToolRequest,
  type CallToolResult,
  type Notification,
  type Request,
  type RequestHandlerExtra,
} from '@frontmcp/protocol';
import { isDebug, isDevelopment } from '@frontmcp/utils';

import type ProviderRegistry from '../../provider/provider.registry';
import { type ToolInputOf, type ToolOutputOf } from '../decorators';
import { type ToolContext } from '../interfaces';
import { type ProviderRegistryInterface } from '../interfaces/internal';
import { type ToolInputType, type ToolMetadata, type ToolOutputType, type UndeclaredKeysPolicy } from '../metadata';
import { type ToolRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

export type ToolCallArgs = CallToolRequest['params']['arguments'];
export type ToolCallExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
  /** Progress token from the request's _meta, used for progress notifications */
  progressToken?: string | number;
  /**
   * Optional context-aware providers from the flow.
   * When provided, this is used instead of the tool's default providers.
   * This enables access to context-scoped providers (from plugins) during tool execution.
   * @internal
   */
  contextProviders?: ProviderRegistryInterface;
  /**
   * AbortSignal provided by the task runner for task-augmented calls
   * (MCP 2025-11-25 tasks spec). Fires on `tasks/cancel`. Absent for non-task
   * invocations.
   */
  signal?: AbortSignal;
};

export type ParsedToolResult = CallToolResult;
export type SafeTransformResult<T> = { success: true; data: T } | { success: false; error: Error };

/** How a tool's answer is parsed against its `outputSchema`. */
export interface OutputParseOptions {
  /** What happens to keys the answer carries that the schema does not declare. @default 'strip' */
  undeclaredKeys?: UndeclaredKeysPolicy;
  /** Called with the undeclared key paths an answer carried, under the `'warn'` policy. */
  onUndeclaredKeys?: (keyPaths: string[]) => void;
}

type OutputJsonSchemaResolution = { schema: Record<string, unknown> | null; unlistedReason?: string };

/** Zod output types that are primitive outputs: they flow through `content` and are never listed. */
const PRIMITIVE_ZOD_OUTPUT_TYPES = new Set<unknown>(['string', 'number', 'boolean', 'bigint', 'date']);

/** How zod refers to a schema registered with an id, or to a reused one: `#/$defs/<name>`. */
const DEFINITION_REF_PREFIX = '#/$defs/';

/**
 * The JSON Schema MCP accepts as a tool's `outputSchema`: an object schema as is, or a union
 * (`anyOf` / `oneOf`) or `$ref` that resolves to object schemas only, typed `object` at the top level.
 */
function asObjectOutputSchema(json: Record<string, unknown>): Record<string, unknown> | null {
  if (json['type'] === 'object') return json;
  return isObjectSchema(json, json['$defs'], new Set()) ? { type: 'object', ...json } : null;
}

/** True for an object schema, a `#/$defs/` reference to one, or a union of those. */
function isObjectSchema(schema: unknown, definitions: unknown, followedRefs: ReadonlySet<string>): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const node = schema as Record<string, unknown>;
  if (node['type'] === 'object') return true;
  const ref = node['$ref'];
  if (typeof ref === 'string') {
    // Each `#/$defs/` reference is followed once: a recursive union can loop a validator forever
    if (!ref.startsWith(DEFINITION_REF_PREFIX) || followedRefs.has(ref)) return false;
    const definition = (definitions as Record<string, unknown> | undefined)?.[ref.slice(DEFINITION_REF_PREFIX.length)];
    return isObjectSchema(definition, definitions, new Set([...followedRefs, ref]));
  }
  const members = node['anyOf'] ?? node['oneOf'];
  return (
    Array.isArray(members) &&
    members.length > 0 &&
    members.every((member) => isObjectSchema(member, definitions, followedRefs))
  );
}

export abstract class ToolEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends BaseEntry<ToolRecord, ToolContext<InSchema, OutSchema, In, Out>, ToolMetadata> {
  owner: EntryOwnerRef;
  /**
   * The name of the tool, as declared in the metadata.
   */
  name: string;
  /**
   * The full name of the tool, including the owner name as prefix.
   */
  fullName: string;

  /**
   * Get the provider registry for this tool.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  abstract get providers(): ProviderRegistry;

  inputSchema: InSchema;
  /**
   * Raw JSON Schema for input, set internally by OpenAPI adapter or remote tools.
   * Not part of the user-facing decorator API (removed in v1.0.0).
   */
  rawInputSchema: unknown;
  // This is your *metadata* outputSchema (literals / zod / raw shapes / arrays)
  outputSchema?: OutSchema;
  /**
   * Raw JSON Schema for output, set internally by OpenAPI adapter or remote tools.
   * Not part of the user-facing decorator API (removed in v1.0.0).
   */
  rawOutputSchema?: unknown;

  /**
   * Accessor used by tools/list to expose the tool's declared outputSchema.
   * This returns the exact value from metadata (string literal, zod schema,
   * raw shape, or an array of those).
   */
  getOutputSchema(): OutSchema | undefined {
    return this.outputSchema;
  }

  /**
   * Accessor used by tools/list to expose the tool's output schema as JSON Schema.
   * Returns the raw JSON Schema representation if available.
   */
  getRawOutputSchema(): unknown | undefined {
    return this.rawOutputSchema;
  }

  /** Cached JSON Schema result (undefined = not yet computed) */
  private _cachedInputJsonSchema?: Record<string, unknown> | null;

  /**
   * Get the tool's input schema as JSON Schema (cached after first call).
   * Returns rawInputSchema if available, otherwise converts from Zod schema shape.
   *
   * This is the single source of truth for tool input schema conversion.
   * Used by skill HTTP utilities and other consumers needing JSON Schema format.
   *
   * @returns JSON Schema object or null if no schema is available
   */
  getInputJsonSchema(): Record<string, unknown> | null {
    if (this._cachedInputJsonSchema !== undefined) return this._cachedInputJsonSchema;

    const result = this.computeInputJsonSchema();
    this._cachedInputJsonSchema = result;
    return result;
  }

  private computeInputJsonSchema(): Record<string, unknown> | null {
    // Prefer rawInputSchema if already in JSON Schema format
    if (this.rawInputSchema) {
      // Validate that rawInputSchema is actually an object before casting
      if (
        typeof this.rawInputSchema === 'object' &&
        this.rawInputSchema !== null &&
        !Array.isArray(this.rawInputSchema)
      ) {
        return this.rawInputSchema as Record<string, unknown>;
      }
      // rawInputSchema exists but isn't a valid object - fall through to conversion
    }

    // Convert Zod schema shape to JSON Schema
    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      try {
        return toJSONSchema(z.object(this.inputSchema), { io: 'input', unrepresentable: 'any' });
      } catch (error) {
        // Log the error for debugging purposes
        if (isDebug() || isDevelopment()) {
          console.warn('[ToolEntry] Failed to convert Zod schema to JSON Schema:', error);
        }
        return { type: 'object', properties: {} };
      }
    }

    return null;
  }

  /** The output JSON Schema and, when a declared schema is left out of tools/list, why (undefined = not yet computed) */
  private outputJsonSchemaResolution?: OutputJsonSchemaResolution;

  /**
   * Get the tool's output schema as JSON Schema (cached after first call).
   *
   * Prefers an explicit `rawOutputSchema` (the JSON Schema set by the OpenAPI adapter /
   * remote tools); otherwise converts a Zod-shape or Zod `outputSchema` to JSON Schema —
   * symmetric with {@link getInputJsonSchema}. MCP requires a top-level `type: 'object'`, so
   * an object schema is returned as is and a union whose members are all object schemas is
   * returned typed `object` (`{ type: 'object', anyOf | oneOf }`). Returns `null` for
   * primitive / media outputs and multi-content arrays, which flow through `content`, and for
   * any other schema (see {@link getUnlistedOutputSchemaReason}).
   *
   * @returns JSON Schema object, or null if there is no advertisable output schema.
   */
  getOutputJsonSchema(): Record<string, unknown> | null {
    return this.resolveOutputJsonSchema().schema;
  }

  /**
   * Why the declared `outputSchema` is left out of tools/list, or undefined when it is listed
   * or is a primitive / media / multi-content output, which is never listed by design.
   */
  getUnlistedOutputSchemaReason(): string | undefined {
    return this.resolveOutputJsonSchema().unlistedReason;
  }

  private resolveOutputJsonSchema(): OutputJsonSchemaResolution {
    this.outputJsonSchemaResolution ??= this.computeOutputJsonSchema();
    return this.outputJsonSchemaResolution;
  }

  private computeOutputJsonSchema(): OutputJsonSchemaResolution {
    // Prefer rawOutputSchema when it is already a JSON Schema object (OpenAPI / remote passthrough).
    if (
      typeof this.rawOutputSchema === 'object' &&
      this.rawOutputSchema !== null &&
      !Array.isArray(this.rawOutputSchema)
    ) {
      return { schema: this.rawOutputSchema as Record<string, unknown> };
    }

    const schema = this.outputSchema as unknown;

    // Primitive / media literals ('string' | 'number' | 'image' | …) and multi-content
    // arrays (['string', 'image']) have no object outputSchema — they flow via `content`.
    if (!schema || typeof schema === 'string' || Array.isArray(schema)) {
      return { schema: null };
    }

    // Duck-type a Zod schema (z.object(), z.discriminatedUnion(), …) vs a raw shape
    // ({ field: z.string() }); identity-based instanceof is avoided so a duplicated zod
    // module copy cannot break detection.
    const isZodSchema =
      typeof (schema as { safeParse?: unknown }).safeParse === 'function' &&
      typeof (schema as { parse?: unknown }).parse === 'function';

    if (!isZodSchema && Object.keys(schema as Record<string, unknown>).length === 0) {
      // Empty raw shape — nothing meaningful to advertise.
      return { schema: null };
    }

    if (isZodSchema && PRIMITIVE_ZOD_OUTPUT_TYPES.has((schema as { type?: unknown }).type)) {
      return { schema: null };
    }

    try {
      // `schema` is a Zod type (z.object()/discriminatedUnion/…) or a raw shape at
      // runtime, but `unknown` to TS. Narrow to the Zod-object type both z.object() and
      // toJSONSchema() accept (the raw-shape cast mirrors the inputSchema path above).
      const zodSchema = isZodSchema ? (schema as ReturnType<typeof z.object>) : z.object(schema as ToolInputType);
      const objectSchema = asObjectOutputSchema(toJSONSchema(zodSchema) as Record<string, unknown>);
      return objectSchema
        ? { schema: objectSchema }
        : { schema: null, unlistedReason: 'it is not an object schema or a union of object schemas' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { schema: null, unlistedReason: `it cannot be converted to JSON Schema (${message})` };
    }
  }

  /**
   * Create a tool context (class or function wrapper).
   */
  abstract create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<InSchema, OutSchema, In, Out>;

  /**
   * Convert the raw tool request input into an MCP CallToolRequest-shaped object.
   */
  abstract parseInput(input: CallToolRequest['params']): CallToolRequest['params']['arguments'];

  /**
   * Convert the raw tool return value (Out) into an MCP CallToolResult-shaped object.
   * Concrete logic is implemented in ToolInstance.
   */
  abstract parseOutput(result: Out | Partial<Out> | any, options?: OutputParseOptions): ParsedToolResult;
  /**
   * Convert the raw tool return value (Out) into an MCP CallToolResult-shaped object.
   * Concrete logic is implemented in ToolInstance.
   */
  abstract safeParseOutput(
    raw: Out | Partial<Out> | any,
    options?: OutputParseOptions,
  ): SafeTransformResult<ParsedToolResult>;
}
