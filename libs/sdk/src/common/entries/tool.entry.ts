// file: libs/sdk/src/common/entries/tool.entry.ts

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
import { type ToolInputType, type ToolMetadata, type ToolOutputType } from '../metadata';
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
        const { z, toJSONSchema } = require('zod');
        return toJSONSchema(z.object(this.inputSchema));
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

  /** Cached output JSON Schema result (undefined = not yet computed, null = none) */
  private _cachedOutputJsonSchema?: Record<string, unknown> | null;

  /**
   * Get the tool's output schema as JSON Schema (cached after first call).
   *
   * Prefers an explicit `rawOutputSchema` (the JSON Schema set by the OpenAPI adapter /
   * remote tools); otherwise converts a Zod-shape or `z.object()` `outputSchema` to JSON
   * Schema — symmetric with {@link getInputJsonSchema}. Returns `null` for output forms
   * that have no object-typed schema to advertise: primitive / media string literals
   * (`'string'`, `'image'`, …), multi-content arrays (`['string', 'image']`), and any
   * schema that does not serialize to a top-level `type: 'object'` (e.g. a union) — those
   * flow through `content`, not `structuredContent`, per the MCP spec.
   *
   * @returns JSON Schema object, or null if there is no advertisable output schema.
   */
  getOutputJsonSchema(): Record<string, unknown> | null {
    if (this._cachedOutputJsonSchema !== undefined) return this._cachedOutputJsonSchema;

    const result = this.computeOutputJsonSchema();
    this._cachedOutputJsonSchema = result;
    return result;
  }

  private computeOutputJsonSchema(): Record<string, unknown> | null {
    // Prefer rawOutputSchema when it is already a JSON Schema object (OpenAPI / remote passthrough).
    if (
      typeof this.rawOutputSchema === 'object' &&
      this.rawOutputSchema !== null &&
      !Array.isArray(this.rawOutputSchema)
    ) {
      return this.rawOutputSchema as Record<string, unknown>;
    }

    const schema = this.outputSchema as unknown;

    // Primitive / media literals ('string' | 'number' | 'image' | …) and multi-content
    // arrays (['string', 'image']) have no object outputSchema — they flow via `content`.
    if (!schema || typeof schema === 'string' || Array.isArray(schema)) {
      return null;
    }

    try {
      const { z, toJSONSchema } = require('zod');
      // Duck-type a Zod schema (z.object(), z.discriminatedUnion(), …) vs a raw shape
      // ({ field: z.string() }); identity-based instanceof is avoided so a duplicated zod
      // module copy cannot break detection.
      const isZodSchema =
        typeof (schema as { safeParse?: unknown }).safeParse === 'function' &&
        typeof (schema as { parse?: unknown }).parse === 'function';

      if (!isZodSchema && Object.keys(schema as Record<string, unknown>).length === 0) {
        // Empty raw shape — nothing meaningful to advertise.
        return null;
      }

      const zodSchema = isZodSchema ? schema : z.object(schema as Record<string, unknown>);
      const json = toJSONSchema(zodSchema) as Record<string, unknown>;

      // MCP requires outputSchema to be a top-level object schema; skip anything else
      // (e.g. a discriminated union serializes to `anyOf`, not `type: 'object'`).
      return json && json['type'] === 'object' ? json : null;
    } catch (error) {
      if (isDebug() || isDevelopment()) {
        console.warn('[ToolEntry] Failed to convert output Zod schema to JSON Schema:', error);
      }
      return null;
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
  abstract parseOutput(result: Out | Partial<Out> | any): ParsedToolResult;
  /**
   * Convert the raw tool return value (Out) into an MCP CallToolResult-shaped object.
   * Concrete logic is implemented in ToolInstance.
   */
  abstract safeParseOutput(raw: Out | Partial<Out> | any): SafeTransformResult<ParsedToolResult>;
}
