---
name: annotations
description: readOnlyHint, destructiveHint, idempotentHint, openWorldHint, title — behavioral hints for clients.
---

# `annotations`

Optional behavioral hints on `@Tool({...})`. AI clients use them to decide whether to gate the call behind a confirmation dialog, parallelize calls, retry on failure, etc.

```typescript
@Tool({
  name: 'delete_user',
  description: 'Delete a user account',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Delete user',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
})
```

## Fields

| Field             | Type      | Default                             | Meaning                                                                        |
| ----------------- | --------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `title`           | `string`  | —                                   | Human-readable display name for client UIs (overrides `name` for presentation) |
| `readOnlyHint`    | `boolean` | `false`                             | Tool only reads — no side effects. Safe to call freely.                        |
| `destructiveHint` | `boolean` | `true` (when `readOnlyHint: false`) | Tool may delete or overwrite. Clients usually trigger a confirmation.          |
| `idempotentHint`  | `boolean` | `false`                             | Repeated calls with same input produce the same result. Safe to retry.         |
| `openWorldHint`   | `boolean` | `true`                              | Tool interacts with external services / network. `false` = local-only.         |

## How clients use them

| Annotation              | Common client behavior                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `readOnlyHint: true`    | Tool may run in parallel with other reads; no confirmation needed  |
| `destructiveHint: true` | Confirmation dialog before invocation; "are you sure?"             |
| `idempotentHint: true`  | Auto-retry on transient failures                                   |
| `openWorldHint: false`  | Hint that the tool is offline-safe                                 |
| `title`                 | Shown in tool pickers and history instead of the snake_case `name` |

## Common combinations

```typescript
// Read-only query tool — safe, retryable
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

// Destructive admin action
annotations: {
  destructiveHint: true,
  idempotentHint: true, // deleting twice still leaves the thing deleted
  openWorldHint: false,
}

// Send an email
annotations: {
  readOnlyHint: false,
  destructiveHint: false, // not destroying, just sending
  idempotentHint: false,  // each call sends a new email
  openWorldHint: true,
}

// External API search
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}
```

## Don't lie to the client

Annotations are advisory but the client trusts them:

- Don't set `readOnlyHint: true` on a tool that writes — clients may parallelize it.
- Don't set `idempotentHint: true` on a tool that has incremental side effects — clients may retry and double up.
- Don't omit `destructiveHint: true` on a delete — users may not get the confirmation they need.

## When to omit annotations entirely

For ambiguous or non-obvious cases, omit. The defaults (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`) are the **conservative** assumption — clients will gate and not parallelize, which is the safe wrong choice if you're unsure.

## See also

- [`20-tool-with-annotations`](../examples/20-tool-with-annotations.md)
- [`decorator-options.md`](./decorator-options.md)
