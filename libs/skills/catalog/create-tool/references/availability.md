---
name: availability
description: availableWhen axes (os / runtime / deployment / provider / target / surface / env), missingAxes, isPlatform, and enabled (fileSignal, FEATURE_OFF, list_changed, the surface hash, STALE_TOOL_LIST).
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

When the constraint fails at call time, FrontMCP throws `EntryUnavailableError` (string code `'ENTRY_UNAVAILABLE'`, JSON-RPC `-32003` FORBIDDEN, HTTP 403). Its `data` carries `missingAxes: string[]` (since #417) so clients can surface a specific reason without parsing prose, and a `remedy` naming the environment the entry needs (none when an axis allows no value, such as `env: []`):

```json
{
  "code": -32003,
  "message": "Prompt \"deploy_notes\" is not available in the current environment (requires: {\"env\":[\"production\"]}) ...",
  "data": {
    "entryType": "Prompt",
    "entry": "deploy_notes",
    "missingAxes": ["env"],
    "constraint": { "env": ["production"] },
    "context": { "env": "development", "...": "..." },
    "remedy": { "say": "Run the server where env is production to use this prompt." },
    "errorId": "err_..."
  }
}
```

`resources/read` and `prompts/get` answer with that JSON-RPC error. `tools/call` answers an `isError: true` result instead: the same message with the remedy as a last `To fix:` line, and `_meta.code: 'ENTRY_UNAVAILABLE'` and `_meta.remedy`.

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

## `enabled` — turned on and off while sessions are live

`availableWhen` is decided at boot. `enabled` is the switch that changes while the server runs, such as a feature a person turns on in a settings page or a flag in a flag service. It is a boolean, or an `EnabledSource`: `get(ctx?)` answers for a request, `subscribe(listener)` calls the listener whenever the answer may have changed (and returns the function that stops it), and an optional `remedy` says how to turn the entry back on. `fileSignal(path, key)` is the built-in source: the boolean under `key` in a JSON file, followed as the file changes.

```typescript
import { fileSignal, Tool, ToolContext } from '@frontmcp/sdk';

const reviews = fileSignal('./features.json', 'reviews', {
  remedy: { say: 'Turn on Reviews in Settings', tool: 'settings_set', args: { feature: 'reviews', on: true } },
});

@Tool({ name: 'review_list', inputSchema: {}, enabled: reviews })
class ReviewListTool extends ToolContext {
  /* … */
}
```

- `@Resource`, `@ResourceTemplate` and `@Prompt` take the same `enabled`. Any other value fails at the decorator: `` `enabled` must be a boolean or an EnabledSource ``.
- An entry that is off is left out of its list (`tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`), and its completers complete nothing. `tools/call` (including `this.callTool()` and a call by an alias), `resources/read`, `resources/subscribe` and `prompts/get` refuse it with `FeatureOffError`: `FEATURE_OFF`, JSON-RPC -32003, `data.status` 403, and the source's remedy (without one, `Ask the server's operator to turn on tool "review_list".`). A source whose `get` throws counts as off.
- The lists are filtered in each list flow's `filterByEnabled` stage and the refusal is the `checkEnabled` stage, so hooks can wrap both.
- When a source's listener fires, every connected session gets `notifications/tools/list_changed` (or the resources or prompts one): one per list per 100 ms, however many entries or changes.
- `fileSignal(path, key, { defaultValue?, pollIntervalMs?, remedy?, logger? })` watches the file's directory and reads the file again every `pollIntervalMs` (default 2000), which is the only check where watching fails. A missing file, or no boolean under `key`, means `defaultValue` (default `false`); content that is not JSON, as a write in progress leaves it, keeps the last value read (`defaultValue` before one was read). Each problem is logged once. A relative `path` is read against the process's working directory. Its default remedy is `Turn on the "reviews" feature, then try again.` Node only.
- A source of your own answers per caller from the request context:

```typescript
import { type EnabledSource } from '@frontmcp/sdk';

const proOnly: EnabledSource = {
  get: (ctx) => plans.isPro(ctx?.authInfo?.extra?.['sub']),
  subscribe: (listener) => plans.onChange(listener),
  remedy: { say: 'Upgrade to Pro to use the billing tools.' },
};
```

A lazy app (`apps: [{ name, lazy: () => import('./billing.app'), enabled }]`) takes the same `enabled` for all its entries: while it is off they are refused with `FEATURE_OFF` and the app is never imported (see `frontmcp-setup` → `multi-app-composition`). Its own entries cannot have a source of their own.

With `@frontmcp/plugin-feature-flags`, `featureFlagSource(adapter, 'beta')` is the `EnabledSource` of a flag. Code that changes what a list shows some other way announces it the same coalesced way with `scope.surface?.listChanged('tools')`.

### The surface hash and stale tool lists

`tools/list`, `resources/list`, `resources/templates/list` and `prompts/list` carry `_meta['frontmcp/surface']` (`SURFACE_META_KEY`): a 16-character hash of the names (URIs for resources, URI templates for templates) the list shows, the same on every page of a paginated list.

FrontMCP also remembers, for each connected session that listed tools (the last 10 000), whether the tool list changed since. A 2026-07-28 or stateless request has no session to remember. A `tools/call` from such a session to a tool that is not in the current list, unknown or off, is answered with `StaleToolListError` (`STALE_TOOL_LIST`, 409, `To fix: Call tools/list again, then call a tool from the new list.`), and the session is sent `notifications/tools/list_changed`. Its next call gets the usual answer (`FEATURE_OFF`, `TOOL_NOT_FOUND`), so a client that never lists again is not stuck. A session that never listed, the task runner's run of a task-augmented call, and in-process `this.callTool()` are never answered `STALE_TOOL_LIST`.

## See also

- [`21-tool-with-availability-constraints`](../examples/21-tool-with-availability-constraints.md)
- [`decorator-options.md`](./decorator-options.md)
