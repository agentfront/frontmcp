// file: libs/plugins/src/codecall/tools/execute.schema.ts
import { z } from '@frontmcp/lazy-zod';

import type { ResolvedCodeCallVmOptions } from '../codecall.symbol';
import {
  MAX_ITERATIONS_PER_LOOP,
  maxToolCallsOf,
  rapidEnumerationThresholdOf,
  resolveVmOptions,
} from '../providers/code-call.config';
import { unavailableGlobals } from '../security/script-policy';

/** Minimum script length - at least a simple callTool invocation */
const MIN_EXECUTE_SCRIPT_LENGTH = 'return callTool("a",{})'.length;

/** Names the AgentScript sandbox refuses in every preset, shown in the description. */
const ALWAYS_BLOCKED_NAMES = ['eval', 'require', 'fetch', 'setTimeout', 'process', 'globalThis'];

/** The globals a model would reach for that the sandbox lacks, with what to use instead; empty when it has them all. */
function unavailableGlobalsLine(): string {
  const names = unavailableGlobals().map(({ name }) => name);
  if (names.length === 0) return '';
  const listed = names.includes('RegExp') ? [...names, 'regex literals'] : names;
  const instead = ['Map, Set, plain objects and arrays'];
  if (names.includes('Promise')) instead.push('parallel(items, fn) for Promise.all');
  return `\nNOT AVAILABLE: ${listed.join(', ')}. Use ${instead.join(', ')}.`;
}

const REVIEW_STATUSES = ' | needs_changes | needs_approval | denied | review_failed';

const REVIEW_LINE =
  '\nREVIEW: the server checks each script and call first. ' +
  'needs_changes: fix what the findings say and send again. ' +
  'needs_approval: a person approves, then send the same script again. ' +
  'denied: do not retry. review_failed: send the same script again later.';

/** The `codecall:execute` description for the server's resolved `vm` options, and whether its `review` is on. */
export function buildExecuteToolDescription(vmOptions: ResolvedCodeCallVmOptions, reviewed = false): string {
  const loops = vmOptions.allowLoops ? 'for, for-of' : 'for-of';
  const blockedLoops = vmOptions.allowLoops ? 'while, do-while' : 'while, do-while, for';
  const blockedNames = new Set([...ALWAYS_BLOCKED_NAMES, ...vmOptions.disabledBuiltins, ...vmOptions.disabledGlobals]);
  const namespaces = ['Math', 'JSON'].filter((name) => !blockedNames.has(name)).map((name) => `${name}.*, `);
  const timeoutSeconds = vmOptions.timeoutMs / 1000;
  const maxToolCalls = maxToolCallsOf(vmOptions);
  const callsPerTool = rapidEnumerationThresholdOf(vmOptions);
  const blockedConsole = vmOptions.allowConsole ? '' : 'console (use mcpLog), ';
  const consoleLine = vmOptions.allowConsole
    ? '\nLOGGING: console.log/info/warn/error/debug or mcpLog(level, message)'
    : '';
  return `Execute AgentScript (safe JS subset) for multi-tool orchestration.

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

ALLOWED: ${loops}, arrow fn, map/filter/reduce/find, ${namespaces.join('')}if/else, destructuring, spread, template literals
BLOCKED: ${blockedLoops}, ${blockedConsole}function decl, ${[...blockedNames].join(', ')}${unavailableGlobalsLine()}${consoleLine}

ERRORS: NOT_FOUND | VALIDATION | EXECUTION | TIMEOUT | ACCESS_DENIED | RATE_LIMITED | RESULT_TOO_LARGE
STATUS: ok | syntax_error | illegal_access | runtime_error | tool_error | timeout${reviewed ? REVIEW_STATUSES : ''}
LIMITS: ${MAX_ITERATIONS_PER_LOOP} iterations per loop, ${timeoutSeconds}s timeout, ${maxToolCalls} tool calls, ${callsPerTool} calls to one tool per 2s (parallel() included), ${vmOptions.maxSanitizeProperties} values (array items and object keys, at every depth) in each tool result and in the return value${reviewed ? REVIEW_LINE : ''}`;
}

export const executeToolDescription = buildExecuteToolDescription(resolveVmOptions());

export const executeToolInputSchema = {
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
};

export type ExecuteToolInput = z.infer<z.ZodObject<typeof executeToolInputSchema>>;

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
  /** @deprecated Never set: stack traces name server files, so results don't carry them. */
  stack: z.string().optional(),
});

const toolErrorPayloadSchema = z.object({
  source: z.literal('tool'),
  toolName: z.string(),
  /**
   * @deprecated Never set: the sandbox resolves sidecar references in a call's arguments before
   * the tool sees them, so they may hold data the script itself never had.
   */
  toolInput: z.unknown().optional(),
  message: z.string(),
  code: z.string().optional(),
  /** @deprecated Never set: the enclave's error data is not sanitized for clients. */
  details: z.unknown().optional(),
});

const timeoutErrorPayloadSchema = z.object({
  message: z.string(),
});

/** What every result carries besides its status. */
const runFields = {
  /** The id of the run's record, set when one was kept. */
  runId: z.string().optional(),
  /** A line per tool call (position, tool, outcome, duration, size), when the server's `trace.level` shows them. */
  trace: z.array(z.string()).optional(),
};

/** What a review found: the rule, what is wrong, where, and how to fix it. */
const reviewFindingSchema = z.object({
  rule: z.string(),
  message: z.string(),
  location: z.object({ line: z.number(), column: z.number() }).optional(),
  suggestion: z.string().optional(),
  toolName: z.string().optional(),
});

/** What a person approves for a `needs_approval` run to go ahead; see the review section of the README. */
const approvalReferenceSchema = z.object({
  /** Covers this script, this call's arguments, the caller and the review policy. */
  id: z.string(),
  toolName: z.string().optional(),
  argumentsHash: z.string().optional(),
  /** Covers any arguments of this tool in this script, up to the grant's `metadata.maxCalls` calls a run. */
  anyArgumentsId: z.string().optional(),
});

/**
 * Result variants
 */
export const codeCallOkResultSchema = z.object({
  status: z.literal('ok'),
  result: z.unknown(),
  logs: z.array(z.string()).optional(),
  ...runFields,
});

export const codeCallSyntaxErrorResultSchema = z.object({
  status: z.literal('syntax_error'),
  error: syntaxErrorPayloadSchema,
  ...runFields,
});

export const codeCallIllegalAccessResultSchema = z.object({
  status: z.literal('illegal_access'),
  error: illegalAccessErrorPayloadSchema,
  ...runFields,
});

export const codeCallRuntimeErrorResultSchema = z.object({
  status: z.literal('runtime_error'),
  error: runtimeErrorPayloadSchema,
  ...runFields,
});

export const codeCallToolErrorResultSchema = z.object({
  status: z.literal('tool_error'),
  error: toolErrorPayloadSchema,
  ...runFields,
});

export const codeCallTimeoutResultSchema = z.object({
  status: z.literal('timeout'),
  error: timeoutErrorPayloadSchema,
  ...runFields,
});

export const codeCallNeedsChangesResultSchema = z.object({
  status: z.literal('needs_changes'),
  findings: z.array(reviewFindingSchema),
  ...runFields,
});

export const codeCallNeedsApprovalResultSchema = z.object({
  status: z.literal('needs_approval'),
  reason: z.string(),
  approval: approvalReferenceSchema.optional(),
  findings: z.array(reviewFindingSchema).optional(),
  ...runFields,
});

export const codeCallDeniedResultSchema = z.object({
  status: z.literal('denied'),
  reason: z.string(),
  findings: z.array(reviewFindingSchema).optional(),
  ...runFields,
});

/** The review itself failed: the same script can be sent again. */
export const codeCallReviewFailedResultSchema = z.object({
  status: z.literal('review_failed'),
  error: z.object({ message: z.string() }),
  ...runFields,
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
  codeCallNeedsChangesResultSchema,
  codeCallNeedsApprovalResultSchema,
  codeCallDeniedResultSchema,
  codeCallReviewFailedResultSchema,
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
export type CodeCallNeedsChangesResult = z.infer<typeof codeCallNeedsChangesResultSchema>;
export type CodeCallNeedsApprovalResult = z.infer<typeof codeCallNeedsApprovalResultSchema>;
export type CodeCallDeniedResult = z.infer<typeof codeCallDeniedResultSchema>;
export type CodeCallReviewFailedResult = z.infer<typeof codeCallReviewFailedResultSchema>;

export type CodeCallExecuteResult =
  | CodeCallOkResult
  | CodeCallSyntaxErrorResult
  | CodeCallIllegalAccessResult
  | CodeCallRuntimeErrorResult
  | CodeCallToolErrorResult
  | CodeCallTimeoutResult
  | CodeCallNeedsChangesResult
  | CodeCallNeedsApprovalResult
  | CodeCallDeniedResult
  | CodeCallReviewFailedResult;
