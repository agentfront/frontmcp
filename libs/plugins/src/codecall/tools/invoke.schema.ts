// file: libs/plugins/src/codecall/tools/invoke.schema.ts
import { z } from 'zod';

export const invokeToolDescription = `Call ONE tool directly. Same as callTool() but without VM overhead.

USE invoke: single tool, no transformation
USE execute: multiple tools, loops, filtering, joining

INPUT: tool (string), input (object matching tool schema)
OUTPUT: { status: "success", result } | { status: "error", error: { type, message } }
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

export const invokeToolOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    result: z.unknown().describe('The tool execution result'),
  }),
  z.object({
    status: z.literal('error'),
    error: z.object({
      type: z
        .enum(['tool_not_found', 'validation_error', 'execution_error', 'permission_denied'])
        .describe('Type of error that occurred'),
      message: z.string().describe('Human-readable error message'),
      details: z.unknown().optional().describe('Additional error details if available'),
    }),
  }),
]);

export type InvokeToolOutput = z.infer<typeof invokeToolOutputSchema>;
