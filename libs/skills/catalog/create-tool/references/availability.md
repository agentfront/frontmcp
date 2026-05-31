---
name: availability
description: availableWhen axes (os / runtime / deployment / provider / target / surface / env), missingAxes, isPlatform.
---

# `availableWhen` — registry-level availability constraints

`availableWhen` is a **hard registry-level constraint** evaluated at server boot. Tools that don't match are filtered out of `tools/list` AND blocked from execution. Different from authorization (per-request) and from rule-based filtering (dynamic).

## Quick example

```typescript
@Tool({
  name: 'apple_notes_search',
  description: 'Search Apple Notes',
  inputSchema,
  outputSchema,
  availableWhen: { os: ['darwin'] }, // macOS-only
})
class AppleNotesSearchTool extends ToolContext {
  /* … */
}
```

On Linux / Windows servers, this tool simply doesn't exist — it's not in `tools/list`, and calling it returns `EntryUnavailableError`.

## Axes

| Axis         | Values                                                                                                                          | Source                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `os`         | `'darwin'`, `'linux'`, `'win32'`                                                                                                | `process.platform` (since #417 — was previously `platform`) |
| `runtime`    | `'node'`, `'browser'`, `'edge'`, `'bun'`, `'deno'`                                                                              | Detected at boot                                            |
| `deployment` | `'serverless'`, `'standalone'`, `'distributed'`, `'browser'`                                                                    | Detected from `frontmcp.config` / env                       |
| `provider`   | `'bare'`, `'docker'`, `'vercel'`, `'lambda'`, `'cloudflare'`, `'netlify'`, `'azure'`, `'gcp'`, `'fly'`, `'render'`, `'railway'` | Auto-detected; override with `FRONTMCP_PROVIDER=<name>`     |
| `target`     | `'cli'`, `'node'`, `'vercel'`, `'lambda'`, `'cloudflare'`, `'browser'`, `'sdk'`, `'mcpb'`, `'distributed'`                      | Set by `frontmcp build --target <x>`; `'unknown'` in dev    |
| `surface`    | `'mcp'`, `'cli'`, `'agent'`, `'job'`, `'http-trigger'`                                                                          | Per-call axis — which entry point is invoking the tool      |
| `env`        | `'production'`, `'development'`, `'test'`                                                                                       | `process.env.NODE_ENV`                                      |

## Semantics

- **Multiple axes** are AND-ed. `{ os: ['darwin'], env: ['production'] }` means macOS in production.
- **Multiple values within an axis** are OR-ed. `os: ['darwin', 'linux']` means macOS OR Linux (not Windows).
- **Omitted axes** are wildcard. No `env` field → matches every env.

```typescript
@Tool({
  name: 'deploy_service',
  // Node.js production-only:
  availableWhen: { runtime: ['node'], env: ['production'] },
})
```

## Error shape on mismatch

When the constraint fails at call time, FrontMCP throws `EntryUnavailableError` (string code `'ENTRY_UNAVAILABLE'`, JSON-RPC `-32003` FORBIDDEN, HTTP 403). Its `data` carries `missingAxes: string[]` (since #417) so clients can surface a specific reason without parsing prose:

```json
{
  "code": -32003,
  "message": "Tool 'deploy_service' is not available in this environment.",
  "data": {
    "missingAxes": ["env"],
    "expected": { "env": ["production"] },
    "actual": { "env": "development" }
  }
}
```

## Imperative checks

You can also check the platform inside `execute()` for branches that aren't hard constraints:

```typescript
async execute(input: Input) {
  if (this.isPlatform('darwin')) {
    return this.useNativeNotes(input);
  }
  return this.useCrossPlatformFallback(input);
}
```

| Method                | Returns                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `this.isPlatform(os)` | `boolean` (alias preserved: `'platform'` works as a deprecated synonym for `'os'`) |
| `this.isRuntime(rt)`  | `boolean`                                                                          |
| `this.isEnv(env)`     | `boolean`                                                                          |

These are fine for ergonomic branching. For tools that **shouldn't exist at all** on certain platforms, prefer the declarative `availableWhen` — it removes the tool from `tools/list` (clients won't even propose it).

## `surface` — the per-call axis

`surface` is the only axis that varies per-call. Use it when a tool should be reachable by some entry points but not others:

```typescript
@Tool({
  name: 'rotate_secrets',
  availableWhen: { surface: ['agent', 'job'] }, // not callable from MCP clients or CLI directly
})
```

This is the safest way to expose internal-only tools that you want an agent / job to call but don't want a user to invoke from a chat UI.

## See also

- [`21-tool-with-availability-constraints`](../examples/21-tool-with-availability-constraints.md)
- [`decorator-options.md`](./decorator-options.md)
