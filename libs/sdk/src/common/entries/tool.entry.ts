// file: libs/sdk/src/common/entries/tool.entry.ts

import { z } from 'zod';
import { BaseEntry, EntryOwnerRef } from './base.entry';
import { ToolRecord } from '../records';
import { ToolContext } from '../interfaces';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { Request, Notification, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolInputOf, ToolOutputOf } from '../decorators';

export type ToolCallArgs = CallToolRequest['params']['arguments'];
export type ToolCallExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
};

export type ParsedToolResult = CallToolResult;

export abstract class ToolEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<InSchema>,
  Out = ToolOutputOf<OutSchema>,
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

  inputSchema: InSchema;
  // This is whatever JSON-schema-ish thing you store for input; keeping type loose
  rawInputSchema: any;
  // This is your *metadata* outputSchema (literals / zod / raw shapes / arrays)
  outputSchema?: OutSchema;

  /**
   * Accessor used by tools/list to expose the tool's declared outputSchema.
   * This returns the exact value from metadata (string literal, zod schema,
   * raw shape, or an array of those).
   */
  getOutputSchema(): OutSchema | undefined {
    return this.outputSchema;
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
  abstract safeParseOutput(result: Out | Partial<Out> | any): z.SafeParseReturnType<In, ParsedToolResult>;
}
