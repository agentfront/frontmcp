// file: libs/plugins/src/codecall/tools/invoke.schema.ts
import { z } from 'zod';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export const invokeToolDescription = `Call ONE tool directly. Returns standard MCP CallToolResult.

USE invoke: single tool, no transformation
USE execute: multiple tools, loops, filtering, joining

INPUT: tool (string), input (object matching tool schema)
OUTPUT: MCP CallToolResult (same as standard tool call)
ERRORS: tool_not_found (→ re-search) | validation_error | execution_error | permission_denied

FLOW: search → describe → invoke`;

export const invokeToolInputSchema = z.object({
  tool: z
    .string()
    .describe(
      'The name of the tool to invoke (e.g., "users:getById", "billing:getInvoice"). Must be a tool you discovered via codecall:search.',
    ),
  input: z
    .record(z.unknown())
    .describe(
      "The input parameters for the tool. Structure must match the tool's input schema (check codecall:describe for schema details).",
    ),
});

export type InvokeToolInput = z.infer<typeof invokeToolInputSchema>;

// Use standard MCP CallToolResult schema - returns same format as direct tool call
export const invokeToolOutputSchema = CallToolResultSchema;

export type InvokeToolOutput = z.infer<typeof invokeToolOutputSchema>;
