---
name: use-this-fail-for-business-errors
constraint: '`this.fail(new SomeMcpError(...))` for business-logic errors — never raw `throw new Error(...)`.'
severity: required
---

# Rule: `this.fail` for business errors, not raw `throw`

## The rule

For errors the user / agent should see (not-found, permission-denied, invalid-input, conflict, etc.), use `this.fail(new SomeMcpError(...))`. Never `throw new Error(...)` — the raw `Error` message gets REDACTED before reaching the client.

## Good

```typescript
import { PublicMcpError, ResourceNotFoundError } from '@frontmcp/sdk';

async execute(input: { id: string }) {
  const record = await this.findRecord(input.id);
  if (!record) {
    this.fail(new ResourceNotFoundError(`record:${input.id}`)); // -32002, message reaches client
  }

  if (record.tenantId !== this.context.authInfo.tenantId) {
    this.fail(new PublicMcpError('Access denied')); // generic public message
  }

  // …
}
```

## Bad

```typescript
// ❌ raw Error — message REDACTED to "Internal error" before reaching client
async execute(input: { id: string }) {
  const record = await this.findRecord(input.id);
  if (!record) {
    throw new Error(`record:${input.id} not found`); // client sees "Internal error"
  }
}
```

## Why

| You throw                              | Client sees                                                  |
| -------------------------------------- | ------------------------------------------------------------ |
| `new PublicMcpError('Quota exceeded')` | `{ code: -32603, message: 'Quota exceeded' }`                |
| `new ResourceNotFoundError('user:42')` | `{ code: -32002, message: 'user:42' }`                       |
| `new Error('Quota exceeded')`          | `{ code: -32603, message: 'Internal error' }` ← **redacted** |

Raw `Error`s are treated as potentially-sensitive infrastructure errors. The framework REDACTS the message before the client sees it (to avoid leaking stack traces, internal IDs, env vars, etc.). `PublicMcpError` (and subclasses) explicitly opt the message into the response.

## Common error classes

| Class                            | Error code                               | HTTP        | Use for                                                                    |
| -------------------------------- | ---------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `PublicMcpError`                 | —                                        | —           | Base. Subclass for domain-specific public errors                           |
| `ResourceNotFoundError`          | `'RESOURCE_NOT_FOUND'` (-32002 JSON-RPC) | 404         | "Thing doesn't exist"                                                      |
| `InvalidInputError`              | `'INVALID_INPUT'`                        | 400         | Cross-field / business-rule input validation (Zod handles per-field shape) |
| `UnauthorizedError`              | `'UNAUTHORIZED'` (-32001 JSON-RPC)       | 401         | Missing credentials                                                        |
| `RateLimitError`                 | `'RATE_LIMIT_EXCEEDED'`                  | 429         | Rate-limit fired                                                           |
| Custom `PublicMcpError` subclass | your choice                              | your choice | Domain-specific errors with structured `data`                              |

## When to throw raw `Error` (or just let it propagate)

For **infrastructure errors** that genuinely should be redacted — network failure, DB unavailable, file-system error. Don't catch them; just let them propagate. The framework wraps them in `InternalMcpError` with the message redacted, and logs the original for ops.

## Verification

```bash
# Find raw `throw new Error(...)` inside tool execute() bodies
grep -rE 'throw new Error\(' src/**/*.tool.ts
# Should match few or none — and any matches should be in non-execute code paths
```
