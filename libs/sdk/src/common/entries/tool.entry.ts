// file: libs/sdk/src/common/entries/tool.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { ToolRecord } from '../records';
import { ToolContext } from '../interfaces';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { Request, Notification, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import { ProviderRegistryInterface } from '../interfaces/internal';
import type ProviderRegistry from '../../provider/provider.registry';

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
  // This is whatever JSON-schema-ish thing you store for input; keeping type loose
  rawInputSchema: any;
  // This is your *metadata* outputSchema (literals / zod / raw shapes / arrays)
  outputSchema?: OutSchema;
  // Raw JSON Schema for output (for tool/list to expose)
  rawOutputSchema?: any;

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
  getRawOutputSchema(): any | undefined {
    return this.rawOutputSchema;
  }

  /**
   * Get the tool's input schema as JSON Schema.
   * Returns rawInputSchema if available, otherwise converts from Zod schema shape.
   *
   * This is the single source of truth for tool input schema conversion.
   * Used by skill HTTP utilities and other consumers needing JSON Schema format.
   *
   * @returns JSON Schema object or null if no schema is available
   */
  getInputJsonSchema(): Record<string, unknown> | null {
    // Prefer rawInputSchema if already in JSON Schema format
    if (this.rawInputSchema) {
      return this.rawInputSchema;
    }

    // Convert Zod schema shape to JSON Schema
    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      try {
        // Dynamic import to avoid circular dependencies
        const { z, toJSONSchema } = require('zod');
        return toJSONSchema(z.object(this.inputSchema));
      } catch {
        return { type: 'object', properties: {} };
      }
    }

    return null;
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
