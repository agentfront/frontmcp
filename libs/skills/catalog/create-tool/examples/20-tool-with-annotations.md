---
name: 20-tool-with-annotations
level: basic
description: 'Four tools showing the standard annotation combinations — read-only query, destructive delete, send-email side-effecting, external-API search — and the client behavior each combination opts into.'
tags: [annotations, readOnlyHint, destructiveHint, idempotentHint, openWorldHint]
features:
  - 'Setting `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` to opt into specific client behaviors (auto-retry, confirmation gating, parallelization)'
  - 'Providing a human-readable `title` that overrides the snake_case `name` in client UIs'
  - "Picking the conservative defaults when the annotations aren't obvious (omitting fields is safer than guessing)"
  - 'Why `send_email` sets `idempotentHint: false` (each call sends a new email) while `delete_user` sets it to `true` (deleting twice still leaves the user deleted)'
---

# Tool With Annotations

Four tools showing the standard annotation combinations — read-only query, destructive delete, send-email side-effecting, external-API search — and the client behavior each combination opts into.

`annotations` are advisory but the client uses them to decide whether to gate, parallelize, or retry. Four canonical combinations cover most tools.

## Code

```typescript
// src/apps/main/tools/annotations.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// 1. Read-only query — safe to call freely, parallelizable, auto-retryable
@Tool({
  name: 'search_users',
  description: 'Search users by name or email',
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).default(10) },
  outputSchema: { users: z.array(z.object({ id: z.string(), email: z.string().email() })) },
  annotations: {
    title: 'Search users',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false, // local DB only
  },
})
export class SearchUsersTool extends ToolContext {
  async execute(_input: { query: string; limit: number }) {
    return { users: [] };
  }
}

// 2. Destructive admin action — confirmation gated, retryable
@Tool({
  name: 'delete_user',
  description: 'Permanently delete a user account',
  inputSchema: { userId: z.string() },
  outputSchema: { deleted: z.boolean() },
  annotations: {
    title: 'Delete user',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true, // deleting twice leaves the user deleted — safe to retry
    openWorldHint: false,
  },
})
export class DeleteUserTool extends ToolContext {
  async execute(_input: { userId: string }) {
    return { deleted: true };
  }
}

// 3. Send-email — side effect, NOT idempotent, external service
@Tool({
  name: 'send_email',
  description: 'Send an email via SMTP',
  inputSchema: { to: z.string().email(), subject: z.string(), body: z.string() },
  outputSchema: { messageId: z.string() },
  annotations: {
    title: 'Send email',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // each call sends a NEW email — don't auto-retry blindly
    openWorldHint: true,
  },
})
export class SendEmailTool extends ToolContext {
  async execute(_input: { to: string; subject: string; body: string }) {
    return { messageId: `<${crypto.randomUUID()}@example.com>` };
  }
}

// 4. External-API search — read-only but talks to the open world
@Tool({
  name: 'web_search',
  description: 'Search the web via an external search API',
  inputSchema: { query: z.string() },
  outputSchema: { results: z.array(z.object({ title: z.string(), url: z.string().url() })) },
  annotations: {
    title: 'Web search',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true, // calls external service
  },
})
export class WebSearchTool extends ToolContext {
  async execute(_input: { query: string }) {
    return { results: [] };
  }
}
```

## What This Demonstrates

- Setting `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` to opt into specific client behaviors (auto-retry, confirmation gating, parallelization)
- Providing a human-readable `title` that overrides the snake_case `name` in client UIs
- Picking the conservative defaults when the annotations aren't obvious (omitting fields is safer than guessing)
- Why `send_email` sets `idempotentHint: false` (each call sends a new email) while `delete_user` sets it to `true` (deleting twice still leaves the user deleted)

## How clients use each annotation

| Annotation              | Common client behavior                                  |
| ----------------------- | ------------------------------------------------------- |
| `readOnlyHint: true`    | May parallelize calls; doesn't gate behind confirmation |
| `destructiveHint: true` | Shows "are you sure?" before execution                  |
| `idempotentHint: true`  | Auto-retries on transient failures                      |
| `openWorldHint: false`  | Hints that the tool is offline-safe                     |
| `title`                 | Replaces the snake_case `name` in the UI                |

## When to omit

If the right value isn't obvious, omit. The defaults are conservative — `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`. Clients will gate and not parallelize, which is the safe wrong choice.
