---
name: error-handling
description: this.fail, MCP error classes, error flow — when to throw vs fail.
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

For errors the framework should handle uniformly (network failure, DB unavailable, timeout), just let them throw. The framework wraps them in an `InternalMcpError` with the message redacted before reaching the client, and logs the original for ops.

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
| `EntryUnavailableError` | `'FORBIDDEN'` (-32003 JSON-RPC)          | 403  | `availableWhen` mismatch at call time                             |
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

## `PublicMcpError` vs raw `Error`

| Throw                                  | Client sees                                                             |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `new PublicMcpError('Quota exceeded')` | `{ code: -32603, message: 'Quota exceeded' }`                           |
| `new Error('Quota exceeded')`          | `{ code: -32603, message: 'Internal error' }` (the message is REDACTED) |

Raw `Error`s have their messages **redacted** before reaching the client — the framework treats them as potentially-sensitive infrastructure errors. For anything the client should read, use `PublicMcpError` or a subclass.

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
