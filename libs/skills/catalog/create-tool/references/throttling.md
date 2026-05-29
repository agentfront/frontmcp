---
name: throttling
description: rateLimit, concurrency, timeout — semantics, interaction, defaults.
---

# Throttling — `rateLimit`, `concurrency`, `timeout`

Three independent controls on `@Tool({...})`. Apply them when the tool calls expensive services, holds a scarce resource, or could legitimately hang.

## `rateLimit`

Cap invocations over a time window.

```typescript
@Tool({
  name: 'send_notification',
  rateLimit: { maxRequests: 100, windowMs: 60_000 }, // 100 calls / minute
  // …
})
```

- **Scope**: per-session by default. The session ID is the rate-limit key. To rate-limit globally, set `scope: 'global'` (be sure the server can absorb the burst).
- **Behavior on overflow**: the tool call returns a `RateLimitError` (HTTP status 429, MCP error code `'RATE_LIMIT_EXCEEDED'`). The error's payload carries a retry-after hint so clients can back off intelligently.
- **No half-allowed**: a call either counts fully toward the limit or doesn't run at all. Long-running calls don't block the window — only the start counts.

## `concurrency`

Cap simultaneous in-flight executions.

```typescript
@Tool({
  name: 'render_pdf',
  concurrency: { maxConcurrent: 5 }, // at most 5 PDFs rendering at once
  // …
})
```

- **Scope**: server-wide by default. Concurrency caps the resource — there's no point in per-session concurrency for shared resources like CPU / GPU / DB connection pools.
- **Behavior on overflow**: the call **queues** until a slot opens. Queue depth is unbounded by default; pair with a `timeout` to avoid pathological backups.
- **Use for**: tools that hold a real bottleneck — image / PDF rendering, ML inference, DB write transactions.

## `timeout`

Hard deadline on a single execution.

```typescript
@Tool({
  name: 'long_query',
  timeout: { executeMs: 30_000 }, // 30s
  // …
})
```

- **Scope**: per call. Wraps the entire `execute()` invocation.
- **Behavior on timeout**: the framework throws a `ToolTimeoutError` (subclass of `PublicMcpError`) and emits a `notifications/cancelled` for any progress token. The tool's `execute()` is signaled via the AbortSignal you can read from `this.context.abortSignal` — propagate it to `this.fetch` and any child operations.
- **Default**: no timeout. Tools can hang forever unless `timeout` is set.

## Interaction

The three controls are **orthogonal** — they apply independently:

```typescript
@Tool({
  name: 'expensive_operation',
  rateLimit:    { maxRequests: 10, windowMs: 60_000 },  // ≤10 starts / min
  concurrency:  { maxConcurrent: 2 },                    // ≤2 simultaneous
  timeout:      { executeMs: 30_000 },                   // ≤30s each
})
```

Order of effects per call:

1. `rateLimit` checked → reject early if over limit (no concurrency slot consumed)
2. `concurrency` checked → queue if all slots taken
3. `timeout` armed → wraps `execute()` once it runs

## Common combinations

| Scenario                               | Recipe                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| Spammy external API                    | `rateLimit: { 60, 60_000 }` (60/min)                                 |
| Shared DB / GPU                        | `concurrency: { maxConcurrent: 5 }`                                  |
| Anything calling LLMs / 3rd-party HTTP | `timeout: { executeMs: 30_000 }`                                     |
| All three                              | `rateLimit: { 10, 60_000 }, concurrency: { 2 }, timeout: { 30_000 }` |

## Propagating the abort signal

When a `timeout` fires, `execute()` receives an AbortSignal via `this.context.abortSignal`. Propagate it to abort in-flight work:

```typescript
async execute(input: { url: string }) {
  const response = await this.fetch(input.url, { signal: this.context.abortSignal });
  return response.json();
}
```

`this.fetch` propagates the signal automatically if you don't pass one — but explicit is safer for nested fetches.

## See also

- [`decorator-options.md`](./decorator-options.md)
- [`error-handling.md`](./error-handling.md)
- [`execution-context.md`](./execution-context.md)
