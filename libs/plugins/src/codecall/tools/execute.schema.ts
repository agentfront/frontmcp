// file: libs/plugins/src/codecall/tools/execute.schema.ts
import { z } from 'zod';

export const executeToolDescription = `Execute AgentScript code to orchestrate multiple tool calls safely.

AgentScript is a restricted JavaScript subset designed for AI agent orchestration. It allows chaining tool calls, transforming data, and implementing logic without sandbox escape risks.

## callTool API
\`await callTool(toolName: string, args: object, options?: { throwOnError?: boolean }): Promise<T | Result<T>>\`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| toolName | string | required | Tool identifier (e.g., 'users:list') |
| args | object | required | Tool arguments as key-value pairs |
| options.throwOnError | boolean | true | When false, returns \`{ success, data, error }\` instead of throwing |

## Result-Based Error Handling (Recommended)
\`\`\`javascript
// Safe pattern - no try/catch needed
const result = await callTool('users:get', { id: '123' }, { throwOnError: false });
if (!result.success) {
  return { failed: true, reason: result.error.code };
}
return result.data;
\`\`\`

## Error Codes
| Code | Description |
|------|-------------|
| NOT_FOUND | Tool not found in registry |
| VALIDATION | Input validation failed |
| EXECUTION | Tool execution error |
| TIMEOUT | Tool execution timed out |
| ACCESS_DENIED | Tool access not permitted |

## Security Restrictions
- **Cannot call codecall:* tools** - Self-reference is blocked
- **Errors are sanitized** - No stack traces or internal details exposed

## Allowed Features
| Feature | Example |
|---------|---------|
| for, for...of loops | for (const x of items) { } |
| Arrow functions | items.map(x => x.id) |
| Array methods | map, filter, reduce, find, sort |
| Math methods | Math.max(), Math.round() |
| JSON methods | JSON.parse(), JSON.stringify() |
| Control flow | if/else, ternary ? : |
| Destructuring | const { id, name } = user |
| Spread | [...items, newItem] |
| Template literals | \`Hello \${name}\` |

## Blocked Features
| Feature | Reason |
|---------|--------|
| while, do...while | Unbounded loops |
| function declarations | No recursion |
| eval, Function | Code execution |
| process, require | System access |
| fetch, XMLHttpRequest | Network access |
| setTimeout | Timing attacks |
| window, globalThis | Global access |

## Example: Data Aggregation
\`\`\`javascript
const users = await callTool('users:list', { role: 'admin', active: true });

const results = [];
for (const user of users.items) {
  const orders = await callTool('orders:list', { userId: user.id });
  const total = orders.items.reduce((sum, o) => sum + o.amount, 0);
  results.push({
    userId: user.id,
    name: user.name,
    orderCount: orders.items.length,
    totalAmount: Math.round(total * 100) / 100
  });
}

return results.sort((a, b) => b.totalAmount - a.totalAmount);
\`\`\`

## Limits
- Max 10,000 iterations per loop
- 30 second execution timeout (configurable)
- Max 100 tool calls per execution

## Result Statuses
- ok: Script executed successfully
- syntax_error: JavaScript syntax error
- illegal_access: Used forbidden API (eval, process, etc.)
- runtime_error: Script threw an error
- tool_error: A tool call failed
- timeout: Script exceeded time limit`;

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
