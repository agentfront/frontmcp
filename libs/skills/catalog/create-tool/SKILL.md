---
name: create-tool
description: |
  ALWAYS use this skill when the user asks to build, modify, or audit a FrontMCP tool.
  Covers everything inside `@Tool({...})`: class and function-style tools, Zod input/output
  schemas with derived `execute()` types, dependency injection (`this.get` / `this.tryGet`),
  error handling (`this.fail`, MCP error classes), throttling (rate-limit / concurrency /
  timeout), auth providers (single / multi / vault), availability constraints
  (`availableWhen`), elicitation (`this.elicit`), interactive UI widgets via `@Tool({ ui })`
  (MCP Apps / SEP-1865 — including `.tsx` FileSource, CSP, `window.FrontMcpBridge`,
  host-detect `resourceMode`), annotations (`readOnlyHint` / `destructiveHint` / …),
  `examples` metadata, registration in `@App({ tools })`, and per-tool unit testing.

  Does NOT cover:
  - Read-only data exposed via a URI — use `create-resource`
  - Conversation templates / system prompts — use `create-prompt`
  - Multi-tool orchestration loops — use `create-agent`
  - Background work / pipelines — use `create-job` / `create-workflow`
  - Server-level config (transport, sessions, auth modes) — use `config` / `auth`

  Triggers: `@Tool`, ToolContext, tool decorator, MCP tool, snake_case tool name,
  inputSchema, outputSchema, ToolInputOf, ToolOutputOf, `@Tool({ ui })`, tool UI widget,
  MCP Apps widget, FileSource widget, `.tsx` widget, ui.csp, ui.resourceMode,
  window.FrontMcpBridge, tool annotations, readOnlyHint, destructiveHint, rate-limit tool,
  throttle tool, concurrency tool, tool timeout, this.fail, this.respond, this.fetch,
  this.notify, this.progress, this.elicit, ElicitationDisabledError, ToolContext.execute,
  this.get(TOKEN), this.tryGet, register tool in @App, tool examples metadata,
  availableWhen, missingAxes, `tool()` function builder, Tool.esm, Tool.remote,
  PublicMcpError, ResourceNotFoundError, MCP_ERROR_CODES, ui://widget.

when_to_use: |
  Trigger when creating or editing a `*.tool.ts` / `*.tool.tsx` file, adding a `@Tool`
  decorator, defining `inputSchema` / `outputSchema` for a tool, deriving `execute()`
  parameter or return types, wiring dependency injection into a tool, returning
  structured / media / resource content, adding a `ui:` block (HTML / MDX / React /
  FileSource), configuring throttling, declaring auth providers, restricting platforms
  via `availableWhen`, requesting interactive input via `this.elicit`, adding tool
  `annotations`, or registering a tool in `@App({ tools })`.

paths: '**/*.tool.ts, **/*.tool.tsx, **/tools/**/*.ts, **/apps/*/tools/**, **/*.tool.spec.ts'

layout: component
license: Apache-2.0
priority: 10
visibility: public
tags:
  [
    development,
    tool,
    create-tool,
    decorator,
    input-schema,
    output-schema,
    ToolContext,
    ui,
    mcp-apps,
    annotations,
    throttling,
    auth-providers,
    availability,
    elicitation,
  ]
category: development/create
bundle: [recommended, minimal, full]
allowed-tools: Read Edit Write Grep Glob Bash

metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/tools
---

# Create a FrontMCP Tool

Tools are the primary way to expose executable actions to AI clients in the MCP protocol. In FrontMCP, every tool is a TypeScript class that extends `ToolContext`, decorated with `@Tool({...})`, and registered on an `@App` (or directly on `@FrontMcp` for simple servers).

This skill is the single source of truth for building tools. It owns:

- The `@Tool` decorator surface
- Input / output schemas and how to derive `execute()` types from them
- Dependency injection, error handling, progress / notifications
- Throttling: rate-limit, concurrency, timeout
- Auth providers and the credential vault
- Platform / runtime / surface availability constraints
- Elicitation (interactive input mid-execution)
- **Tool UI widgets** — the `ui:` block, MCP Apps / SEP-1865, `.tsx` FileSource, CSP, `window.FrontMcpBridge`
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- The `examples` metadata field
- Function-style tools, remote / ESM tools
- Registration patterns
- Per-tool unit testing

For everything else — resources, prompts, agents, jobs, workflows, adapters, plugins, providers, channels — use the matching `create-<thing>` skill.

> **First time?** Start with [`references/quick-start.md`](./references/quick-start.md), then jump to the example matching your scenario via the [Decision Tree](#decision-tree) below.

---

## Inherited defaults

This skill ALWAYS applies these defaults — never opt out without an audited reason:

| Default                                                                          | Source                                                                                                     | What it enforces                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **`inputSchema` is a Zod raw shape**                                             | [`rules/input-schema-is-raw-shape.md`](./rules/input-schema-is-raw-shape.md)                               | Plain object mapping field → Zod type. Framework wraps internally. Never `z.object(...)` at the top level.       |
| **`outputSchema` is always defined**                                             | [`rules/always-define-output-schema.md`](./rules/always-define-output-schema.md)                           | Prevents data leaks, enables CodeCall chaining, gives compile-time type safety.                                  |
| **`execute()` types are derived from the schemas**                               | [`rules/derive-execute-types.md`](./rules/derive-execute-types.md)                                         | `ToolInputOf<>` / `ToolOutputOf<>` over the hoisted schemas. Schema is the single source of truth.               |
| **`class MyTool extends ToolContext`** — no generics                             | [`rules/no-toolcontext-generics.md`](./rules/no-toolcontext-generics.md)                                   | Types are auto-inferred from `@Tool`. Explicit generics are redundant and forbidden.                             |
| **Tool names are `snake_case`**                                                  | [`rules/snake-case-tool-names.md`](./rules/snake-case-tool-names.md)                                       | MCP protocol convention. `get_weather`, not `getWeather`.                                                        |
| **No `try/catch` around `execute()`**                                            | [`rules/no-try-catch-around-execute.md`](./rules/no-try-catch-around-execute.md)                           | The framework's flow catches and formats errors. Wrapping defeats it.                                            |
| **`this.fail(new McpError(…))` for business errors**                             | [`rules/use-this-fail-for-business-errors.md`](./rules/use-this-fail-for-business-errors.md)               | Triggers the error flow with proper JSON-RPC codes. Raw `throw` skips it.                                        |
| **Register tools in `@App({ tools })`**                                          | [`rules/register-in-app.md`](./rules/register-in-app.md)                                                   | Apps own modularity and lifecycle. Top-level `@FrontMcp({ tools })` is the simple-server escape hatch.           |
| **`.tsx` widget paths use `fileURLToPath(new URL('./x.tsx', import.meta.url))`** | [`rules/widget-paths-anchor-with-import-meta-url.md`](./rules/widget-paths-anchor-with-import-meta-url.md) | Relative `FileSource` paths resolve against `process.cwd()` — the workaround is mandatory (issue #444).          |
| **Leave `ui.resourceMode` unset by default**                                     | [`rules/widget-resource-mode-host-detect.md`](./rules/widget-resource-mode-host-detect.md)                 | The framework host-detects: Claude → `'inline'`, others → `'cdn'` (issue #456). Set explicitly only to override. |

If a request seems to conflict with an inherited default (e.g., "wrap `inputSchema` in `z.object` to use refinements", or "use `try/catch` to swallow upstream errors"), **stop and ask** — never silently override.

---

## When to invoke this skill

### Must use

- Creating a new `*.tool.ts` file
- Adding the `@Tool({...})` decorator
- Defining or changing `inputSchema` / `outputSchema`
- Adding a `ui:` block to a tool (any template type)
- Adding `annotations`, `rateLimit`, `concurrency`, `timeout`, `authProviders`, `availableWhen`, `examples` to a tool
- Calling `this.elicit(...)` from `execute()`
- Registering a tool in `@App({ tools })` or `@FrontMcp({ tools })`
- Writing the unit test for a tool

### Recommended

- Auditing an existing tool for the inherited defaults above
- Picking between class-style and function-style (`tool({...})(handler)`)
- Choosing the right output-schema variant for the data you're returning
- Converting a tool's auth from a single string to the full `{ name, scopes, required }` mapping
- Deciding whether a side-effecting tool needs `destructiveHint: true`

### Skip when

- You're not building a tool. Use the matching `create-<thing>` skill.

---

## Decision tree

```
1. What kind of tool?
   ├── Tiny one-off → function-style: `tool({...})((input, ctx) => …)`
   │   See: examples/02-basic-function-tool.md
   ├── Anything with DI, lifecycle, hooks, or UI → class-style
   │   See: examples/01-basic-class-tool.md
   └── Externally hosted (ESM URL or remote MCP server) → Tool.esm / Tool.remote
       See: references/remote-and-esm.md

2. What does it return?
   ├── Structured JSON          → outputSchema: { field: z.string(), … }
   │                              See: examples/03-tool-with-zod-shape-output.md
   ├── A primitive (text/num)   → outputSchema: 'string' | 'number' | 'boolean' | 'date'
   │                              See: examples/05-tool-with-primitive-output.md
   ├── Media (image/audio)      → outputSchema: 'image' | 'audio'
   │                              See: examples/06-tool-with-media-output.md
   ├── A resource link          → outputSchema: 'resource' | 'resource_link'
   │                              See: examples/26-tool-with-resource-link-output.md
   └── Several content blocks   → outputSchema: ['string', 'image']
                                  See: examples/06-tool-with-media-output.md

3. Does it need shared services / config / clients?
   YES → register a @Provider; inject via this.get(TOKEN)
         See: examples/08-tool-with-provider-injection.md

4. Does it call an external HTTP API?
   YES → use this.fetch(input, init?) (context propagation)
         See: examples/11-tool-with-fetch.md

5. Does it need user credentials from an OAuth provider?
   YES → declare authProviders: ['provider'] (or full mapping)
         See: examples/13-tool-with-single-auth-provider.md, 15-tool-with-credential-vault.md

6. Is it expensive / rate-limited / slow?
   YES → add rateLimit / concurrency / timeout
         See: examples/16-tool-with-rate-limit.md, 17-tool-with-concurrency-and-timeout.md

7. Does it run for a while? Want progress?
   YES → call this.progress(n, total, msg)
         See: examples/18-tool-with-progress-and-notify.md

8. Does it need a confirmation / extra input mid-run?
   YES → this.elicit('msg', { fieldSchema })
         See: examples/19-tool-with-elicitation.md

9. Is it destructive / read-only / idempotent / open-world?
   YES → annotations: { destructiveHint, readOnlyHint, idempotentHint, openWorldHint }
         See: examples/20-tool-with-annotations.md

10. Should it only run on certain OSes / runtimes / build targets?
    YES → availableWhen: { os, runtime, deployment, provider, target, surface, env }
          See: examples/21-tool-with-availability-constraints.md

11. Should the result render as a widget in the host UI?
    YES → ui: { template, … }
          ├── Quick HTML            → ui: { template: (ctx) => '<div>…</div>' }
          │                            See: examples/22-tool-with-ui-html-template.md
          ├── React widget (file)   → ui: { template: { file: widgetPath } }
          │                            See: examples/23-tool-with-ui-filesource-tsx.md
          ├── Calls other tools     → widgetAccessible: true + window.FrontMcpBridge
          │                            See: examples/24-tool-with-ui-csp-and-bridge.md
          └── Claude target         → resourceMode is auto-detected; do not set
                                       See: references/ui-widgets.md

12. Does it hand off long work to a job?
    YES → kick off a job + return a tracking handle
          See: examples/25-tool-handing-off-to-job.md
```

---

## Scenario routing table

| Scenario                                     | Example                                                                                        | Why                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Build the simplest possible tool             | [`01-basic-class-tool`](./examples/01-basic-class-tool.md)                                     | Foundation — every other example builds on this shape                   |
| One-off math / formatter                     | [`02-basic-function-tool`](./examples/02-basic-function-tool.md)                               | `tool()` builder is fine for trivial pure-input tools                   |
| Return structured JSON                       | [`03-tool-with-zod-shape-output`](./examples/03-tool-with-zod-shape-output.md)                 | Raw Zod shape — recommended for any complex output                      |
| Output is a complex Zod schema               | [`04-tool-with-zod-schema-output`](./examples/04-tool-with-zod-schema-output.md)               | `z.object()` / `z.array()` / `z.discriminatedUnion()` for full Zod      |
| Output is a primitive                        | [`05-tool-with-primitive-output`](./examples/05-tool-with-primitive-output.md)                 | `'string'` / `'number'` / `'date'` literals                             |
| Output is binary / multi-content             | [`06-tool-with-media-output`](./examples/06-tool-with-media-output.md)                         | `'image'`, `'audio'`, `['string', 'image']`                             |
| Tool resolves dependencies via DI            | [`08-tool-with-provider-injection`](./examples/08-tool-with-provider-injection.md)             | `this.get(TOKEN)` against a `@Provider`-registered service              |
| Tool composes multiple services              | [`09-tool-with-multiple-providers`](./examples/09-tool-with-multiple-providers.md)             | Realistic shape — DB + cache + config in one tool                       |
| Tool calls an external HTTP API              | [`11-tool-with-fetch`](./examples/11-tool-with-fetch.md)                                       | `this.fetch(url, init?)` — context propagation, error handling          |
| Tool calls a flaky API with retries          | [`12-tool-with-fetch-and-retries`](./examples/12-tool-with-fetch-and-retries.md)               | Exponential backoff, idempotency-key, retry config                      |
| Tool needs OAuth credentials                 | [`13-tool-with-single-auth-provider`](./examples/13-tool-with-single-auth-provider.md)         | `authProviders: ['github']` — string shorthand                          |
| Tool needs scoped / optional creds           | [`14-tool-with-multiple-auth-providers`](./examples/14-tool-with-multiple-auth-providers.md)   | Full mapping form with `required` + `scopes` + `alias`                  |
| Tool reads a per-session secret              | [`15-tool-with-credential-vault`](./examples/15-tool-with-credential-vault.md)                 | `this.authProviders.headers(...)`, vault patterns                       |
| Rate-limit an expensive operation            | [`16-tool-with-rate-limit`](./examples/16-tool-with-rate-limit.md)                             | `rateLimit: { maxRequests, windowMs }`                                  |
| Cap concurrency + add a timeout              | [`17-tool-with-concurrency-and-timeout`](./examples/17-tool-with-concurrency-and-timeout.md)   | Production-ready throttling shape                                       |
| Long-running tool with progress              | [`18-tool-with-progress-and-notify`](./examples/18-tool-with-progress-and-notify.md)           | `this.progress` + `this.notify` + `this.mark`                           |
| Tool that asks the user mid-run              | [`19-tool-with-elicitation`](./examples/19-tool-with-elicitation.md)                           | `this.elicit` with Zod schema                                           |
| Tool with behavioral hints for the client    | [`20-tool-with-annotations`](./examples/20-tool-with-annotations.md)                           | `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` |
| Tool restricted to one OS / runtime / target | [`21-tool-with-availability-constraints`](./examples/21-tool-with-availability-constraints.md) | `availableWhen` axes                                                    |
| Tool with a quick inline HTML widget         | [`22-tool-with-ui-html-template`](./examples/22-tool-with-ui-html-template.md)                 | `ui: { template: (ctx) => '<div>…</div>' }`                             |
| Tool with a separate `.tsx` widget file      | [`23-tool-with-ui-filesource-tsx`](./examples/23-tool-with-ui-filesource-tsx.md)               | `FileSource` + `import.meta.url` anchoring                              |
| Tool widget that calls other tools           | [`24-tool-with-ui-csp-and-bridge`](./examples/24-tool-with-ui-csp-and-bridge.md)               | `widgetAccessible: true` + `window.FrontMcpBridge.callTool`             |
| Tool that triggers a job + tracks it         | [`25-tool-handing-off-to-job`](./examples/25-tool-handing-off-to-job.md)                       | Thin tool + heavy job — the right split                                 |
| Tool that returns a resource handle          | [`26-tool-with-resource-link-output`](./examples/26-tool-with-resource-link-output.md)         | `outputSchema: 'resource_link'` — the host fetches the resource         |
| Tool with `examples` metadata for discovery  | [`27-tool-with-examples-metadata`](./examples/27-tool-with-examples-metadata.md)               | `examples: [{ description, input, output? }]`                           |

---

## Verification checklist

Before considering a tool "done":

- [ ] Class extends `ToolContext` (no generics) OR uses `tool()` function builder
- [ ] `@Tool({ name, description, inputSchema, outputSchema })` — all four present
- [ ] `name` is `snake_case`
- [ ] `inputSchema` is a Zod raw shape (NOT wrapped in `z.object`)
- [ ] `outputSchema` is defined (Zod shape / primitive / media / array)
- [ ] `execute()` parameter and return types derived via `ToolInputOf<>` / `ToolOutputOf<>`
- [ ] No `try/catch` around `execute()` body
- [ ] Business errors use `this.fail(new SomeMcpError(…))`, not raw `throw`
- [ ] Tool registered in an `@App({ tools })` (or `@FrontMcp({ tools })` for single-app servers)
- [ ] If `ui:`: `.tsx` widget paths anchored via `fileURLToPath(new URL(...))`
- [ ] If `ui:`: `ui.resourceMode` left unset (host-detect) unless an explicit override is intentional
- [ ] Unit test in `<name>.tool.spec.ts` covering happy + at least one failure path
- [ ] Optional: `annotations`, `rateLimit` / `concurrency` / `timeout`, `authProviders`, `availableWhen`, `examples` set when the tool's behavior warrants them

---

## References (deep dives)

| Reference                                                             | Covers                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`quick-start.md`](./references/quick-start.md)                       | 60-second tour: minimal tool, registration, calling it from a test                                                    |
| [`decorator-options.md`](./references/decorator-options.md)           | Every field on `@Tool({...})` — what it does, default, when to set it                                                 |
| [`input-schema.md`](./references/input-schema.md)                     | Raw shape vs `z.object`, refinements, defaults, optional, describe                                                    |
| [`output-schema.md`](./references/output-schema.md)                   | All supported output types: Zod shape, Zod schema, primitives, media, arrays                                          |
| [`derived-types.md`](./references/derived-types.md)                   | `ToolInputOf` / `ToolOutputOf` patterns, file layout, schema hoisting                                                 |
| [`execution-context.md`](./references/execution-context.md)           | `ToolContext` methods + properties — `this.get`, `this.fetch`, `this.notify`, `this.context`, etc.                    |
| [`error-handling.md`](./references/error-handling.md)                 | `this.fail`, MCP error classes (`PublicMcpError`, `ResourceNotFoundError`), error flow, when to throw vs `fail`       |
| [`throttling.md`](./references/throttling.md)                         | `rateLimit`, `concurrency`, `timeout` — semantics, interaction, defaults                                              |
| [`auth-providers.md`](./references/auth-providers.md)                 | `authProviders` string shorthand vs full mapping, scopes, alias, credential vault basics                              |
| [`availability.md`](./references/availability.md)                     | `availableWhen` axes (os / runtime / deployment / provider / target / surface / env), `missingAxes`, `isPlatform`     |
| [`elicitation.md`](./references/elicitation.md)                       | `this.elicit`, server-level enable, `ElicitationDisabledError`, accept / decline / cancel                             |
| [`ui-widgets.md`](./references/ui-widgets.md)                         | `@Tool({ ui })` — template formats, `servingMode`, `resourceMode` host-detect, CSP, `widgetAccessible`, MCP Apps spec |
| [`annotations.md`](./references/annotations.md)                       | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title`                                         |
| [`function-style-builder.md`](./references/function-style-builder.md) | `tool({...})(handler)` — when to pick over a class, register, ctx parameter                                           |
| [`remote-and-esm.md`](./references/remote-and-esm.md)                 | `Tool.esm(...)` / `Tool.remote(...)` — load tools from ESM URLs or remote MCP servers                                 |
| [`registration.md`](./references/registration.md)                     | `@App({ tools })` vs `@FrontMcp({ tools })`, multi-app composition                                                    |
| [`file-layout.md`](./references/file-layout.md)                       | Flat-sibling vs folder-per-tool, `<name>.schema.ts` / `<name>.tool.ts` / `<name>.tool.spec.ts`                        |
| [`testing.md`](./references/testing.md)                               | Per-tool unit tests — `@frontmcp/testing`, mocking DI, asserting output validation                                    |

## Rules (constraints — read these once, then they're enforced)

| Rule                                                                                                 | Constraint                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`input-schema-is-raw-shape.md`](./rules/input-schema-is-raw-shape.md)                               | `inputSchema` is a raw Zod shape, never `z.object(...)`                              |
| [`always-define-output-schema.md`](./rules/always-define-output-schema.md)                           | Every tool defines `outputSchema`                                                    |
| [`derive-execute-types.md`](./rules/derive-execute-types.md)                                         | `execute()` types come from `ToolInputOf` / `ToolOutputOf` — never duplicated inline |
| [`no-toolcontext-generics.md`](./rules/no-toolcontext-generics.md)                                   | `class MyTool extends ToolContext` — no `<typeof inputSchema>` generic               |
| [`snake-case-tool-names.md`](./rules/snake-case-tool-names.md)                                       | Tool `name` is `snake_case`                                                          |
| [`no-try-catch-around-execute.md`](./rules/no-try-catch-around-execute.md)                           | The framework owns error flow — don't wrap `execute()` body                          |
| [`use-this-fail-for-business-errors.md`](./rules/use-this-fail-for-business-errors.md)               | `this.fail(new McpError(…))` — never raw `throw` for business errors                 |
| [`register-in-app.md`](./rules/register-in-app.md)                                                   | Register tools in `@App({ tools })` for modularity / lifecycle                       |
| [`widget-paths-anchor-with-import-meta-url.md`](./rules/widget-paths-anchor-with-import-meta-url.md) | `.tsx` widget paths via `fileURLToPath(new URL(...))` — never bare relative          |
| [`widget-resource-mode-host-detect.md`](./rules/widget-resource-mode-host-detect.md)                 | Leave `ui.resourceMode` unset — let host detect                                      |

## Accessing this skill

| Mode               | How                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/create-tool/` directly. `SKILL.md` is the entry point.                                                                           |
| **CLI**            | `frontmcp skills list`, `frontmcp skills read create-tool`, `frontmcp skills read create-tool:references/<file>.md`, `frontmcp skills install create-tool` |
| **MCP `skill://`** | When mounted on a FrontMCP server, available at `skill://create-tool/SKILL.md`, `skill://create-tool/references/{file}.md`, etc. (SEP-2640)                |

## Related skills

`create-resource`, `create-prompt`, `create-agent`, `create-provider`, `create-job`, `create-workflow`, `create-adapter`, `create-plugin`, `decorators-guide`, `architecture`, `testing`, `auth`
