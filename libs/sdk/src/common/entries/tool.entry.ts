// file: libs/sdk/src/common/entries/tool.entry.ts

import { z } from 'zod';
import { BaseEntry, EntryOwnerRef } from './base.entry';
import { ToolRecord } from '../records';
import { ToolContext } from '../interfaces';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { Request, Notification, CallToolRequest, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export type ToolCallArgs = CallToolRequest['params']['arguments'];
export type ToolCallExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
};

// Minimal MCP-shaped result type; concrete implementation lives in ToolInstance
export interface ParsedToolResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

export abstract class ToolEntry<In extends ToolInputType, Out extends ToolOutputType = ToolOutputType> extends BaseEntry<
  ToolRecord,
  ToolContext<In, Out>,
  ToolMetadata
> {
  owner: EntryOwnerRef;

  inputSchema: z.ZodObject<any>;
  // This is whatever JSON-schema-ish thing you store for input; keeping type loose
  rawInputSchema: any;
  // This is your *metadata* outputSchema (literals / zod / raw shapes / arrays)
  outputSchema?: ToolMetadata['outputSchema'];

  /**
   * Accessor used by tools/list to expose the tool's declared outputSchema.
   * This returns the exact value from metadata (string literal, zod schema,
   * raw shape, or an array of those).
   */
  getOutputSchema(): ToolMetadata['outputSchema'] | undefined {
    return this.outputSchema;
  }

  /**
   * Create a tool context (class or function wrapper).
   */
  abstract create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<In, Out>;

  /**
   * Convert the raw tool return value (Out) into an MCP CallToolResult-shaped object.
   * Concrete logic is implemented in ToolInstance.
   */
  abstract parseOutput(result: Out): ParsedToolResult;
}
