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
- **Behavior on overflow**: with the default `queueTimeoutMs: 0`, the call is refused at once with `ConcurrencyLimitError` (code `CONCURRENCY_LIMIT`, HTTP 429). Set `queueTimeoutMs` to let it wait that long for a slot; it then fails with `QueueTimeoutError`.
- **Slot lifetime**: a call holds its slot until `execute()` returns, however long that takes. The slot is stored with a time to live (300 seconds) that the server renews while the call runs, so the TTL only frees the slot of a server that died without releasing it.
- **Storage**: shared limits (`throttle.storage`) need a backend with an atomic compare-and-delete: memory, Redis, Upstash, Vercel KV or SQLite (`{ type: 'sqlite', sqlite: { path } }`, shared by the processes on one machine). With another backend, global or default concurrency refuses to start, and a tool's own `concurrency` fails its first call, with `GUARD_STORAGE_UNSUPPORTED`.
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
- **Behavior on timeout**: the framework throws an `ExecutionTimeoutError` (from `@frontmcp/guard`, code `'EXECUTION_TIMEOUT'`, HTTP status 408) and aborts `this.signal`, so `execute()` can observe the abort and pass the signal to cancellable work (see [Timeout and abort signals](#timeout-and-abort-signals)).
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

`this.signal` is aborted when the call is cancelled (including `tasks/cancel` for a task-augmented call) and when its `timeout` passes. Separately from a tool's `concurrency`, `@FrontMcp({ tasks: { maxConcurrentPerSession } })` (default 16, at most 1000) caps how many tasks one caller may have unfinished at once; a task over it is refused with `CONCURRENCY_LIMIT`. Every task write also records the task in a per-session index beside the task records (`index:<session>:<n>`, `index-count:<session>`). `tasks/list` reads from `@FrontMcp({ tasks: { listFrom } })`: `'index'`, the default since 1.13, reads one page of the index in position order (tasks are numbered as they are written; the first list of a session numbers its earlier unindexed tasks after those, in task-id order), so a page costs reads in proportion to its size, and a run of deleted or expired tasks is read once and jumped on later lists (the first list of a session whose tasks an earlier version wrote scans the task keys once to index them; a task write never scans); `'scan'` reads every stored task key of every session, in task-id order, as up to 1.12. A deployment upgrading from a version without the index sets `'scan'` until every instance writes the index: a task an older instance writes during a rolling upgrade has no index entry, so `'index'` does not list it (`tasks/get` still finds it). A cursor goes on in the order its first page was read in, also while another request indexes the session's earlier tasks. Deleting a task releases its concurrency slot even when its index entry cannot be removed. The index's keys take whole-second TTLs whatever `tasks.maxTtlMs` is, and its count lives as long as the longest-lived task, an extended or backfilled one included; concurrent writes never shorten it (an atomic TTL check on memory, Redis, Upstash and Vercel KV). An update that sets an expiry can be retried after a failure, and a backfill picks up an expiry an update set while it ran. The SQLite task store (`tasks.sqlite`) queries by session either way. `FrontMcpContext` has no `abortSignal` property, so don't reach for `this.context.abortSignal`.

`this.fetch()` is aborted with `this.signal` on its own, on top of its per-request timeout (default 30s). Pass `this.signal` to any other cancellable work, so a timed-out call stops instead of running on:

```typescript
async execute(input: { reportId: string }) {
  const response = await this.fetch(`https://reports.example.com/${input.reportId}`);
  return this.get(ReportRenderer).render(await response.json(), { signal: this.signal });
}
```

The deadline answers the client, but it cannot stop code that ignores the signal. Until `execute()` returns, the call keeps its concurrency slot, and keeps renewing it.

## See also

- [`decorator-options.md`](./decorator-options.md)
- [`error-handling.md`](./error-handling.md)
- [`execution-context.md`](./execution-context.md)
