// file: libs/plugins/src/codecall/tools/execute.schema.ts
import { z } from 'zod';

export const executeToolDescription = `Execute JavaScript code in a secure VM sandbox that can orchestrate multiple tools. Use this for complex workflows, data transformations, and multi-tool operations.

WHEN TO USE:
- You need to call MULTIPLE tools in sequence
- You need to filter, transform, join, or aggregate data from tool results
- You need conditional logic, loops, or complex orchestration
- You want to keep intermediate results in the VM instead of sending them through the model context

WHEN NOT TO USE:
- You just need to call a single tool once → Use codecall:invoke instead (lower latency)

HOW IT WORKS:
1. You write JavaScript code that orchestrates tools
2. The code runs in a secure VM2 sandbox with CSP-like policies
3. Inside your code, use callTool(name, input) to invoke tools
4. Tools are called through the normal FrontMCP pipeline (PII, auth, logging all apply)
5. The script's return value becomes the result

AVAILABLE IN THE SANDBOX:
- callTool(toolName, input) → Promise<result>
  Call a tool and get its result. Example: await callTool('users:list', { limit: 10 })

- getTool(toolName) → { name, description, inputSchema, outputSchema }
  Get metadata about a tool without calling it

- codecallContext (read-only object)
  Runtime context you provided in the context parameter

- mcpLog(level, message, metadata?)
  Log messages (if logging is enabled in VM config)

- mcpNotify(eventType, data?)
  Send notifications (if notifications are enabled in VM config)

- console.log/warn/error (if console is enabled in VM config)

NOT AVAILABLE (security):
- require, import, eval, Function constructor
- process, global, setTimeout, setInterval
- fetch, XMLHttpRequest (unless explicitly enabled)
- File system access

WORKFLOW:
1. codecall:search → Find tools you need
2. codecall:describe → Check their schemas and see usage examples
3. codecall:execute → Write JavaScript that orchestrates them

EXAMPLE:
{
  "script": "async function main() {
    const users = await callTool('users:list', { limit: 100 });
    const invoices = await callTool('billing:listInvoices', { status: 'unpaid' });

    // Join in JavaScript
    const byUserId = new Map(invoices.items.map(i => [i.userId, i]));
    return users.items
      .filter(u => byUserId.has(u.id))
      .map(u => ({
        userId: u.id,
        userName: u.name,
        invoice: byUserId.get(u.id)
      }));
  }
  return main();",
  "allowedTools": ["users:list", "billing:listInvoices"],
  "context": { "tenantId": "acme-corp" }
}

RESULT STATUSES:
- ok: Script executed successfully, result is in the result field
- syntax_error: JavaScript syntax error (check error.location for line/column)
- illegal_access: Tried to use forbidden API (eval, process, etc.)
- runtime_error: Script threw an error during execution
- tool_error: A specific tool call failed (check error.toolName)
- timeout: Script exceeded the time limit

ERROR RECOVERY:
- For syntax_error: Fix your JavaScript syntax
- For illegal_access: Remove forbidden APIs (check error.kind)
- For runtime_error: Debug your script logic
- For tool_error: Check the tool input or handle the tool failure
- For timeout: Simplify your script or remove loops

SECURITY:
- Runs in isolated VM2 sandbox with AST validation
- Same PII/auth/logging guarantees as normal tool calls
- Configurable timeouts, loop detection, and API restrictions
- Read the blog post for CSP preset details (locked_down, secure, balanced, experimental)`;

export const executeToolInputSchema = z.object({
  script: z
    .string()
    .describe(
      'JavaScript code to execute in the sandbox. Must return a value (implicitly or via explicit return). Use callTool(name, input) to invoke tools.',
    ),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe(
      'Optional whitelist of tool names that can be called from this script. If not provided, all indexed tools are available. Example: ["users:list", "billing:getInvoice"]',
    ),
  context: z
    .record(z.unknown())
    .optional()
    .describe(
      'Optional read-only context object available to the script as `codecallContext`. Use this to pass tenant IDs, user info, or other runtime data.',
    ),
});

export type ExecuteToolInput = z.infer<typeof executeToolInputSchema>;

/**
 * Shared "payload" schemas
 */
const syntaxErrorPayloadSchema = z.object({
  message: z.string(),
  location: z
    .object({
      line: z.number(),
      column: z.number(),
    })
    .optional(),
});

const illegalAccessErrorPayloadSchema = z.object({
  message: z.string(),
  kind: z.union([
    z.literal('IllegalBuiltinAccess'),
    z.literal('DisallowedGlobal'),
    z.string(), // same as your original type: 'A' | 'B' | string
  ]),
});

const runtimeErrorPayloadSchema = z.object({
  source: z.literal('script'),
  message: z.string(),
  name: z.string().optional(),
  stack: z.string().optional(),
});

const toolErrorPayloadSchema = z.object({
  source: z.literal('tool'),
  toolName: z.string(),
  toolInput: z.unknown(),
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

const timeoutErrorPayloadSchema = z.object({
  message: z.string(),
});

/**
 * Result variants
 */
export const codeCallOkResultSchema = z.object({
  status: z.literal('ok'),
  result: z.unknown(),
  logs: z.array(z.string()).optional(),
});

export const codeCallSyntaxErrorResultSchema = z.object({
  status: z.literal('syntax_error'),
  error: syntaxErrorPayloadSchema,
});

export const codeCallIllegalAccessResultSchema = z.object({
  status: z.literal('illegal_access'),
  error: illegalAccessErrorPayloadSchema,
});

export const codeCallRuntimeErrorResultSchema = z.object({
  status: z.literal('runtime_error'),
  error: runtimeErrorPayloadSchema,
});

export const codeCallToolErrorResultSchema = z.object({
  status: z.literal('tool_error'),
  error: toolErrorPayloadSchema,
});

export const codeCallTimeoutResultSchema = z.object({
  status: z.literal('timeout'),
  error: timeoutErrorPayloadSchema,
});

/**
 * Discriminated union for the whole result
 */
export const executeToolOutputSchema = z.discriminatedUnion('status', [
  codeCallOkResultSchema,
  codeCallSyntaxErrorResultSchema,
  codeCallIllegalAccessResultSchema,
  codeCallRuntimeErrorResultSchema,
  codeCallToolErrorResultSchema,
  codeCallTimeoutResultSchema,
]);

/**
 * Inferred types
 * (you can export whichever ones you actually need)
 */
export type CodeCallOkResult = z.infer<typeof codeCallOkResultSchema>;
export type CodeCallSyntaxErrorResult = z.infer<typeof codeCallSyntaxErrorResultSchema>;
export type CodeCallIllegalAccessResult = z.infer<typeof codeCallIllegalAccessResultSchema>;
export type CodeCallRuntimeErrorResult = z.infer<typeof codeCallRuntimeErrorResultSchema>;
export type CodeCallToolErrorResult = z.infer<typeof codeCallToolErrorResultSchema>;
export type CodeCallTimeoutResult = z.infer<typeof codeCallTimeoutResultSchema>;

export type CodeCallExecuteResult =
  | CodeCallOkResult
  | CodeCallSyntaxErrorResult
  | CodeCallIllegalAccessResult
  | CodeCallRuntimeErrorResult
  | CodeCallToolErrorResult
  | CodeCallTimeoutResult;
