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
  // 100 calls / minute, shared across all callers (partitionBy defaults to 'global')
  rateLimit: { maxRequests: 100, windowMs: 60_000 },
  // For a per-session limit instead:
  // rateLimit: { maxRequests: 100, windowMs: 60_000, partitionBy: 'session' },
  // …
})
```

- **Partition**: `partitionBy: 'global'` by default — one shared limit across all callers. To scope the limit per session, set `partitionBy: 'session'` (the session ID becomes the rate-limit key). Other values: `'userId'`, `'ip'`, or a custom `(ctx) => string` function.
- **Behavior on overflow**: the tool call returns a `RateLimitError` (HTTP status 429, MCP error code `'RATE_LIMIT_EXCEEDED'`). The retry-after hint is carried in the error message string (`Rate limit exceeded. Retry after N seconds`) so clients can back off intelligently.
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
- **Behavior on timeout**: the framework throws an `ExecutionTimeoutError` (from `@frontmcp/guard`, code `'EXECUTION_TIMEOUT'`, HTTP status 408) and aborts the wrapped execution. The abort is internal to the timeout guard — it is **not** surfaced into `execute()` as a readable signal, so don't expect to observe it from inside the tool body.
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

| Scenario                               | Recipe                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Spammy external API                    | `rateLimit: { maxRequests: 60, windowMs: 60_000 }` (60/min)                                                           |
| Shared DB / GPU                        | `concurrency: { maxConcurrent: 5 }`                                                                                   |
| Anything calling LLMs / 3rd-party HTTP | `timeout: { executeMs: 30_000 }`                                                                                      |
| All three                              | `rateLimit: { maxRequests: 10, windowMs: 60_000 }, concurrency: { maxConcurrent: 2 }, timeout: { executeMs: 30_000 }` |

## Timeout and abort signals

`this.signal` is aborted when the call is cancelled (including `tasks/cancel` for a task-augmented call) and when its `timeout` passes. `FrontMcpContext` has no `abortSignal` property, so don't reach for `this.context.abortSignal`.

`this.fetch()` is aborted with `this.signal` on its own, on top of its per-request timeout (default 30s). Pass `this.signal` to any other cancellable work, so a timed-out call stops instead of running on:

```typescript
async execute(input: { reportId: string }) {
  const response = await this.fetch(`https://reports.example.com/${input.reportId}`);
  return this.get(ReportRenderer).render(await response.json(), { signal: this.signal });
}
```

The deadline answers the client, but it cannot stop code that ignores the signal. Until `execute()` returns, the call keeps its concurrency slot.

## See also

- [`decorator-options.md`](./decorator-options.md)
- [`error-handling.md`](./error-handling.md)
- [`execution-context.md`](./execution-context.md)
