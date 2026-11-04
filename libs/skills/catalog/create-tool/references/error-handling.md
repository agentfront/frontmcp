---
name: error-handling
description: this.fail, MCP error classes, refused() and remedies, error flow — when to throw vs fail.
---

# Error handling

## The rule

**Don't `try/catch` around `execute()`** ([rule](../rules/no-try-catch-around-execute.md)). The framework's flow catches exceptions, formats them into proper JSON-RPC errors, runs error hooks, and emits notifications. Wrapping the body defeats all of that.

```typescript
// ❌ swallows the error, breaks the framework's flow
async execute(input: Input) {
  try {
    const result = await someOperation();
    return result;
  } catch (err) {
    this.fail(err instanceof Error ? err : new Error(String(err)));
  }
}

// ✅ let it propagate
async execute(input: Input) {
  return await someOperation();
}
```

## Business-logic errors → `this.fail`

For errors the user / agent should see (not-found, permission-denied, invalid-input, conflict, etc.), use `this.fail(new SomeMcpError(…))`:

```typescript
async execute(input: { id: string }) {
  const record = await this.findRecord(input.id);
  if (!record) {
    this.fail(new ResourceNotFoundError(`record:${input.id}`));
    // ↑ never returns; flow aborts here
  }
  // … keep going with `record` (typed as non-null because fail() doesn't return)
}
```

`this.fail` throws internally and never returns — TypeScript knows it's a `never`-returning method.

## Infrastructure errors → propagate

For errors the framework should handle uniformly (network failure, DB unavailable, timeout), just let them throw. The framework wraps them in an `InternalMcpError` with the message redacted before reaching the client, and logs it once, with the same `errorId` the client sees. The logged message includes the original error's message and stack in every environment; the wrapper's own stack is logged in development only. A `PublicMcpError` (or subclass) thrown from `execute()` is not wrapped: tools, resources and prompts pass it on with its own message and code.

Code that catches errors around entries, such as a hook, can apply the same rules with two predicates from `@frontmcp/sdk`. `isClientFacingError(error)` is true for a public error or an authorities refusal, which pass through unwrapped. `isMrtrSignal(error)` is true for an `InputRequiredSignal` or a `MissingClientCapabilityError`, which the 2026-07-28 dispatcher answers itself, so rethrow them.

## MCP error classes

All from `@frontmcp/sdk`. The two roots: `PublicMcpError` (message reaches the client verbatim) and `InternalMcpError` (message is redacted; full details go to logs).

| Class                   | Error code                               | HTTP | When                                                              |
| ----------------------- | ---------------------------------------- | ---- | ----------------------------------------------------------------- |
| `PublicMcpError`        | —                                        | —    | Base for public errors. Subclass for domain-specific cases.       |
| `InternalMcpError`      | —                                        | —    | Base for redacted infra errors                                    |
| `ResourceNotFoundError` | `'RESOURCE_NOT_FOUND'` (-32002 JSON-RPC) | 404  | A specific resource doesn't exist                                 |
| `ToolNotFoundError`     | `'TOOL_NOT_FOUND'`                       | 404  | Tool name not registered                                          |
| `InvalidInputError`     | `'INVALID_INPUT'`                        | 400  | Cross-field / business-rule input invalid (Zod handles per-field) |
| `InvalidMethodError`    | `'INVALID_METHOD'`                       | 400  | Wrong protocol method called                                      |
| `UnauthorizedError`     | `'UNAUTHORIZED'` (-32001 JSON-RPC)       | 401  | Missing credentials                                               |
| `EntryUnavailableError` | `'ENTRY_UNAVAILABLE'` (-32003 JSON-RPC)  | 403  | `availableWhen` mismatch at call time                             |
| `FeatureOffError`       | `'FEATURE_OFF'` (-32003 JSON-RPC)        | 403  | The tool, resource or prompt's `enabled` is off                   |
| `StaleToolListError`    | `'STALE_TOOL_LIST'`                      | 409  | A call from a session whose tool list changed since it listed     |
| `RateLimitError`        | `'RATE_LIMIT_EXCEEDED'`                  | 429  | Rate-limit fired                                                  |
| `QuotaExceededError`    | `'QUOTA_EXCEEDED'`                       | 429  | Quota-style limit fired                                           |
| `PayloadTooLargeError`  | `'PAYLOAD_TOO_LARGE'`                    | 413  | Body limit exceeded                                               |

`MCP_ERROR_CODES` is the JSON-RPC numeric-code constant map (`UNAUTHORIZED: -32001`, `RESOURCE_NOT_FOUND: -32002`, `FORBIDDEN: -32003`, `INVALID_PARAMS: -32602`, `INTERNAL_ERROR: -32603`, etc.). The classes use string error codes; the numeric codes appear on the JSON-RPC wire response.

```typescript
import { InvalidInputError, MCP_ERROR_CODES, PublicMcpError, ResourceNotFoundError } from '@frontmcp/sdk';

this.fail(new ResourceNotFoundError(`record:${input.id}`));
this.fail(new InvalidInputError('start must be before end'));
```

## Custom error classes

Subclass `PublicMcpError` for domain-specific errors:

```typescript
class QuotaExceededError extends PublicMcpError {
  readonly mcpErrorCode = -32100; // any custom code outside the reserved JSON-RPC ranges

  constructor(public readonly remaining: number) {
    super(`Quota exceeded — ${remaining} requests left in window`);
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: { remaining: this.remaining },
    };
  }
}

// usage
this.fail(new QuotaExceededError(0));
```

The `data` payload lets you surface structured info to the client (rate-limit remaining, validation field errors, etc.) without leaking internals.

## Refusals that carry a remedy

When the caller can get past a refusal, say how. `refused(message, { code?, status?, remedy? })` builds a `PublicMcpError` (`'REFUSED'` and 403 unless you pass others) whose `remedy` is `{ say, tool?, args? }`: what to do and, when a tool does it, that tool and its arguments.

```typescript
import { refused } from '@frontmcp/sdk';

if (!settings.reviewsEnabled) {
  this.fail(
    refused('Reviews are off', {
      code: 'FEATURE_OFF',
      remedy: { say: 'Turn on Reviews in Settings', tool: 'settings_set', args: { feature: 'reviews' } },
    }),
  );
}
```

| Answer                                                | Where the remedy goes                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tools/call` (`isError: true` result)                 | A last line of the text, `To fix: Turn on Reviews in Settings (call settings_set with {"feature":"reviews"})`, and `_meta.remedy` |
| JSON-RPC error (`resources/read`, `prompts/get`, ...) | `data.remedy`                                                                                                                     |

A subclass passes its remedy as the fifth argument of `PublicMcpError`: `super(message, code, status, undefined, { say: '...' })`. Built-in refusals with a remedy: `EntryUnavailableError` names the environment the entry's `availableWhen` asks for (`Run the server where env is production to use this tool.`), the feature-flag plugin's `FEATURE_FLAG_DISABLED` names the flag to turn on, `FEATURE_OFF` carries the remedy of the entry's `EnabledSource`, and `STALE_TOOL_LIST` says to call `tools/list` again (see [`enabled`](./availability.md#enabled--turned-on-and-off-while-sessions-are-live)).

## `PublicMcpError` vs raw `Error`

| Throw                                  | `resources/read` / `prompts/get` error                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `new PublicMcpError('Quota exceeded')` | `{ code: -32602, message: 'Quota exceeded' }`                             |
| `new Error('Quota exceeded')`          | `{ code: -32603, message: 'Internal FrontMCP error. … error ID: err_…' }` |

`tools/call` answers with an `isError: true` result instead, carrying the same message plus `_meta.code` and `_meta.errorId`. The error's `data` always carries the `errorId`. A public error's JSON-RPC code comes from its `toJsonRpcError()`, else its `statusCode`: 401 → -32001, 403 → -32003, other 4xx → -32602.

In production, raw `Error`s have their messages **redacted** before reaching the client — the framework treats them as potentially-sensitive infrastructure errors. For anything the client should read, use `PublicMcpError` or a subclass.

The same holds for a tool that runs as a task (`execution.taskSupport`): `tasks/get` / `tasks/result` carry exactly the result an inline call returns, so `this.fail()` and a thrown `PublicMcpError` keep their message and code, and a raw `Error` is redacted in the task too.

## A failure the caller reads as structured content

`this.fail()` answers with text only. When a failed call should keep its structured result, so the model or a script
reads the same fields a success has, return a complete `CallToolResult` with `isError: true`. The flow sends it as it
is, without checking it against the `outputSchema`, and `execute()` may declare it next to the output type:

```typescript
import { type CallToolResult } from '@frontmcp/sdk';

@Tool({ name: 'import_rows', inputSchema, outputSchema: { imported: z.number(), error: z.string().optional() } })
class ImportRowsTool extends ToolContext {
  async execute(input: { rows: string[] }): Promise<{ imported: number } | CallToolResult> {
    const failedAt = input.rows.findIndex((row) => row.trim() === '');
    if (failedAt === -1) return { imported: input.rows.length };
    const output = { imported: failedAt, error: `row ${failedAt} is empty` };
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: true };
  }
}
```

Keep `structuredContent` valid for the `outputSchema`: a client that lists it may still check it. A generated CLI
exits 1 for an `isError` result. Up to 1.11.0, `@Tool` refused a `CallToolResult` return type on a tool with an
`outputSchema`, though the flow already sent one as it is.

## Non-null assertions are forbidden

```typescript
// ❌ masks failures
const rec = this.defs.get(token)!;

// ✅ proper handling
const rec = this.defs.get(token);
if (!rec) this.fail(new ResourceNotFoundError(`def:${token}`));
```

## See also

- [`rules/no-try-catch-around-execute.md`](../rules/no-try-catch-around-execute.md)
- [`rules/use-this-fail-for-business-errors.md`](../rules/use-this-fail-for-business-errors.md)
- [`execution-context.md`](./execution-context.md)
