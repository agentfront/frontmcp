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

| Axis         | Values                                                                                                                          | Source                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `os`         | `'darwin'`, `'linux'`, `'win32'`                                                                                                | `process.platform` (since #417 — was previously `platform`)                                                                                                                                   |
| `runtime`    | `'node'`, `'browser'`, `'edge'`, `'bun'`, `'deno'`                                                                              | Detected at boot                                                                                                                                                                              |
| `deployment` | `'serverless'`, `'standalone'`, `'distributed'`, `'browser'`                                                                    | Detected from `frontmcp.config` / env                                                                                                                                                         |
| `provider`   | `'bare'`, `'docker'`, `'vercel'`, `'lambda'`, `'cloudflare'`, `'netlify'`, `'azure'`, `'gcp'`, `'fly'`, `'render'`, `'railway'` | Auto-detected; override with `FRONTMCP_PROVIDER=<name>`                                                                                                                                       |
| `target`     | `'cli'`, `'node'`, `'vercel'`, `'lambda'`, `'cloudflare'`, `'browser'`, `'sdk'`, `'mcpb'`, `'distributed'`                      | Set by `frontmcp build --target <x>` in every artifact (`globalThis.FRONTMCP_BUILD_TARGET`; first to run wins, so a `cli` binary loading its server bundle stays `'cli'`); `'unknown'` in dev |
| `surface`    | `'mcp'`, `'cli'`, `'agent'`, `'job'`, `'http-trigger'`, `'webmcp'`                                                              | Per-call axis — which entry point is invoking the tool                                                                                                                                        |
| `env`        | `'production'`, `'development'`, `'test'`                                                                                       | `NODE_ENV`, read live (a Worker's `[vars]` beats a bundler's inlined constant)                                                                                                                |

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

An MCP client (and the in-process client of a CLI build, surface `'cli'`) never sees such a tool: it is absent from `tools/list`, and `tools/call` answers `Tool "rotate_secrets" not found`, exactly as for a tool that doesn't exist. Resources, resource templates, prompts, agents and skills (including the skills HTTP endpoints, which count as `'mcp'`) follow the same rule, and CodeCall applies its caller's surface to the tools it reaches. An agent's model calls its tools on `'agent'` (and is only offered those its `surface` allows), a job's or workflow step's `this.callTool()` on `'job'`, a `@Channel` handling a webhook on `'http-trigger'`, and an in-browser agent calling through WebMCP (`@frontmcp/plugin-webmcp`) on `'webmcp'`. A tool, resource or prompt calling `this.callTool()` is in-process dispatch: that call carries no surface and is not restricted. Code reads its call's surface with `getCallSurface()`. The process-wide axes (`os`, `runtime`, ...) answer `EntryUnavailableError` instead.

## See also

- [`21-tool-with-availability-constraints`](../examples/21-tool-with-availability-constraints.md)
- [`decorator-options.md`](./decorator-options.md)
