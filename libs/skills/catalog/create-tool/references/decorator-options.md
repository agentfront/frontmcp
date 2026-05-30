---
name: decorator-options
description: Every field on @Tool({...}) — what it does, default, when to set it.
---

# `@Tool({...})` options

Full surface of the `@Tool` decorator. Mandatory fields are bolded.

| Field             | Type                                                                           | Default    | When to set                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`name`**        | `string` (snake_case)                                                          | —          | Always. MCP protocol convention. `get_weather`, not `getWeather`.                                                                                                                                                                                               |
| `description`     | `string`                                                                       | —          | Almost always. Shows in `tools/list` and helps clients choose the right tool.                                                                                                                                                                                   |
| **`inputSchema`** | Zod raw shape                                                                  | —          | Always. `{ field: z.string() }` — never wrapped in `z.object`. See [`input-schema.md`](./input-schema.md).                                                                                                                                                      |
| `outputSchema`    | Zod raw shape / Zod schema / primitive literal / media literal / array         | —          | **Always** — prevents data leaks and enables CodeCall chaining. See [`output-schema.md`](./output-schema.md).                                                                                                                                                   |
| `annotations`     | `{ title?, readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? }` | —          | When the tool has notable behavioral semantics clients should be hinted about. See [`annotations.md`](./annotations.md).                                                                                                                                        |
| `rateLimit`       | `{ maxRequests, windowMs }`                                                    | —          | Expensive / external-dependent / abuse-prone tools. See [`throttling.md`](./throttling.md).                                                                                                                                                                     |
| `concurrency`     | `{ maxConcurrent }`                                                            | —          | Tools that hold a scarce resource (DB connection, GPU). See [`throttling.md`](./throttling.md).                                                                                                                                                                 |
| `timeout`         | `{ executeMs }`                                                                | —          | Any tool that could legitimately hang. See [`throttling.md`](./throttling.md).                                                                                                                                                                                  |
| `authProviders`   | `string[]` \| `Array<{ name, scopes?, required?, alias? }>`                    | —          | Tool requires user OAuth credentials. See [`auth-providers.md`](./auth-providers.md).                                                                                                                                                                           |
| `availableWhen`   | `{ os?, runtime?, deployment?, provider?, target?, surface?, env? }`           | —          | Hard registry-level constraint — tool is filtered out of `tools/list` and execution when context doesn't match. See [`availability.md`](./availability.md).                                                                                                     |
| `examples`        | `Array<{ description, input, output? }>`                                       | —          | Discovery / docs surfacing. The client may show these to the user.                                                                                                                                                                                              |
| `ui`              | `ToolUIConfig<In, Out>`                                                        | —          | Tool result should render as a widget in the host UI. See [`ui-widgets.md`](./ui-widgets.md).                                                                                                                                                                   |
| `visibility`      | `'public' \| 'hidden' \| 'internal'`                                           | `'public'` | Control discoverability/reachability. `'public'`: listed in `tools/list` + callable via `tools/call`. `'hidden'`: not listed, still callable by name. `'internal'`: not listed AND not externally callable — only via `this.callTool(...)` from inside the SDK. |

> `hideFromDiscovery: boolean` is a **deprecated** alias for `visibility`: when `visibility` is unset, `hideFromDiscovery: true` is treated as `visibility: 'hidden'`. Prefer `visibility` in new code.

> The decorator is type-safe: `outputSchema` flows back into `ToolContext.execute()`'s return type without needing explicit generics on the class. See [`derived-types.md`](./derived-types.md).

## Mandatory fields

- `name` — must be unique within the server, `snake_case`. Used as the lookup key for `tools/call`.
- `inputSchema` — even an empty-input tool declares `inputSchema: {}`. The framework wraps it in `z.object(...)` internally and validates every call.

## Almost-always-set fields

- `description` — without it the tool is anonymous in `tools/list`. AI clients pick tools based on description text.
- `outputSchema` — see [`rules/always-define-output-schema.md`](../rules/always-define-output-schema.md).

## Field interactions

- **`rateLimit` + `concurrency`** — independent. Rate-limit caps invocations over time; concurrency caps simultaneous in-flight. A "1 req/s with max 2 concurrent" tool is fine: bursts can run two at once, then back off.
- **`timeout` + `rateLimit`** — orthogonal. Timeout wraps a single call; rate-limit wraps the rate of calls.
- **`authProviders` + `ui.widgetAccessible`** — the widget bridge respects the tool's auth requirements. A widget that calls back to a tool requiring `authProviders: ['github']` will fail in the bridge if no GitHub session exists.
- **`availableWhen` + `visibility`** — `availableWhen` is a hard constraint (filtered out of `tools/list` AND blocked from execution when context doesn't match); `visibility: 'hidden'` is a soft hide (filtered from `tools/list` but still callable by name). `visibility: 'internal'` blocks external `tools/call` entirely (in-process `this.callTool` only).
- **`ui.servingMode === 'static'` + `availableWhen`** — static widgets pre-compile at startup. If a tool is filtered out by `availableWhen`, its static widget isn't compiled either.

## Forbidden combinations

- `inputSchema: z.object(...)` at the top level — see [`rules/input-schema-is-raw-shape.md`](../rules/input-schema-is-raw-shape.md).
- `extends ToolContext<typeof inputSchema>` — explicit generics on the class. See [`rules/no-toolcontext-generics.md`](../rules/no-toolcontext-generics.md).
- Mixing function-style `tool({...})(handler)` with class-style `@Tool` + `extends ToolContext` for the same tool. Pick one.

## Minimal vs production

```typescript
// Minimal — fine for a prototype tool
@Tool({
  name: 'ping',
  description: 'Liveness check',
  inputSchema: {},
  outputSchema: 'string',
})
class PingTool extends ToolContext {
  execute(): string {
    return 'pong';
  }
}
```

```typescript
// Production — full surface for a real action
@Tool({
  name: 'create_issue',
  description: 'Create a GitHub issue in the active repo',
  inputSchema,
  outputSchema,
  annotations: { title: 'Create issue', destructiveHint: false, idempotentHint: false, openWorldHint: true },
  rateLimit: { maxRequests: 30, windowMs: 60_000 },
  concurrency: { maxConcurrent: 5 },
  timeout: { executeMs: 30_000 },
  authProviders: [{ name: 'github', required: true, scopes: ['repo'] }],
  availableWhen: { surface: ['mcp', 'agent'] },
  examples: [{ description: 'File a bug', input: { title: 'X is broken', body: '…' } }],
})
class CreateIssueTool extends ToolContext {
  /* … */
}
```

## See also

- [`rules/`](../rules/) — short DO/DON'T constraints per field
- [`execution-context.md`](./execution-context.md) — what `ToolContext` provides at runtime
