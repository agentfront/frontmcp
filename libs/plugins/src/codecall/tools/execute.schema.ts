// file: libs/plugins/src/codecall/tools/execute.schema.ts
import { z } from 'zod';

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
export const codeCallExecuteResultSchema = z.discriminatedUnion('status', [
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
