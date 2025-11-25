// file: libs/plugins/src/codecall/tools/invoke.schema.ts
import { z } from 'zod';

export const invokeToolDescription = `Directly invoke a single tool without running JavaScript code. Use this for simple, one-and-done actions.

WHEN TO USE:
- You need to call exactly ONE tool with specific parameters
- The task is straightforward and doesn't require orchestration, filtering, or data transformation
- You want lower latency than codecall:execute (no VM overhead)

WHEN NOT TO USE:
- You need to call multiple tools in sequence
- You need to filter, transform, or join data from tool results
- You need conditional logic or loops
- → In these cases, use codecall:execute instead

HOW IT WORKS:
1. You provide the tool name and input parameters
2. CodeCall validates the input against the tool's schema
3. The tool is called directly through the normal FrontMCP pipeline (PII plugins, auth, rate limiting, logging all apply)
4. The result is returned immediately

WORKFLOW:
1. codecall:search → Find the tool you need
2. codecall:describe → Check its input schema
3. codecall:invoke → Call it directly with validated parameters

EXAMPLE:
{
  "tool": "users:getById",
  "input": { "id": "user_123" }
}

Returns:
{
  "status": "success",
  "result": { "id": "user_123", "name": "John", "email": "john@example.com" }
}

ERROR HANDLING:
- tool_not_found: The tool name doesn't exist (typo or wrong app)
- validation_error: Input doesn't match the tool's schema
- execution_error: The tool failed during execution
- permission_denied: You don't have access to this tool

SECURITY:
- Same security guarantees as normal tool calls
- PII plugins see and can filter inputs/outputs
- Auth plugins enforce permissions
- No code execution or VM sandbox (that's codecall:execute)`;

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
