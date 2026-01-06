// file: libs/plugins/src/codecall/tools/execute.schema.ts
import { z } from 'zod';

/** Minimum script length - at least a simple callTool invocation */
const MIN_EXECUTE_SCRIPT_LENGTH = 'return callTool("a",{})'.length;

export const executeToolDescription = `Execute AgentScript (safe JS subset) for multi-tool orchestration.

API: await callTool(name, args, opts?)
- Default: throws on error
- Safe mode: { throwOnError: false } → returns { success, data?, error? }

EXAMPLE:
const users = await callTool('users:list', { active: true });
const results = [];
for (const u of users.items) {
  const orders = await callTool('orders:list', { userId: u.id });
  results.push({ id: u.id, total: orders.items.reduce((s,o) => s + o.amount, 0) });
}
return results;

ALLOWED: for, for-of, arrow fn, map/filter/reduce/find, Math.*, JSON.*, if/else, destructuring, spread, template literals
BLOCKED: while, do-while, function decl, eval, require, fetch, setTimeout, process, globalThis

ERRORS: NOT_FOUND | VALIDATION | EXECUTION | TIMEOUT | ACCESS_DENIED
STATUS: ok | syntax_error | illegal_access | runtime_error | tool_error | timeout
LIMITS: 10K iter/loop, 30s timeout, 100 calls max`;

export const executeToolInputSchema = z.object({
  script: z
    .string()
    .min(MIN_EXECUTE_SCRIPT_LENGTH)
    .max(100 * 1024) // 100 KB
    .describe(
      'JavaScript code to execute in the sandbox. Must return a value (implicitly or via explicit return). Use callTool(name, input) to invoke tools.',
    ),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe(
      'Optional whitelist of tool names that can be called from this script. If not provided, all indexed tools are available. Example: ["users:list", "billing:getInvoice"]',
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
