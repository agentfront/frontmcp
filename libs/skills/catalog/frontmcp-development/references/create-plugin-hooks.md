---
name: create-plugin-hooks
description: Intercept and extend FrontMCP flows using before, after, around, finally, and stage hook decorators
---

# Creating Plugins with Flow Lifecycle Hooks

Plugins intercept and extend FrontMCP flows using lifecycle hook decorators. Every flow (tool calls, resource reads, prompt gets, etc.) is composed of **stages**, and hooks let you run logic before, after, around, or as part of any stage, or after it whatever its outcome.

## When to Use This Skill

### Must Use

- Adding before/after logic to tool execution (logging, metrics, input enrichment)
- Implementing authorization checks that intercept flows before they reach the tool
- Wrapping stage execution with caching, retry, or timing logic via `@Around`
- Closing what a hook opened (a span, a timer, a lock) after a stage, whether it succeeded or failed, via `@Finally`

### Recommended

- Adding a step to a built-in stage, or ending the flow early from it, with `@Stage`
- Adding hooks directly on a `@Tool` class for tool-specific pre/post processing
- Filtering hook execution by tool name or context properties using `filter` predicates

### Skip When

- You need providers, context extensions, or contributed tools (see `create-plugin`)
- You want to use an existing official plugin that already provides hooks (see `official-plugins`)
- You are building a simple tool with no cross-cutting concerns (see `create-tool`)

> **Decision:** Use this skill when you need to intercept or wrap flow stages with `@Will`, `@Did`, `@Around`, `@Finally`, or `@Stage` decorators.

## Hook Decorator Types

FrontMCP provides five hook decorators obtained via `FlowHooksOf(flowName)`:

| Decorator  | Timing                                                   | Use Case                                         |
| ---------- | -------------------------------------------------------- | ------------------------------------------------ |
| `@Will`    | **Before** a stage runs                                  | Validate input, inject headers, check auth       |
| `@Did`     | **After** a stage succeeds; skipped when it fails        | Log results, emit metrics, transform output      |
| `@Stage`   | **Joins** a stage, alongside the flow's own step         | Extra work in the stage, ending the flow early   |
| `@Around`  | **Wraps** a stage (before + after)                       | Caching, timing, retry, skipping the stage       |
| `@Finally` | **After** a stage, whatever its outcome; can't change it | Close spans, timers or locks; record the failure |

### FlowHooksOf API

```typescript
import { FlowHooksOf } from '@frontmcp/sdk';

const { Stage, Will, Did, Around, Finally } = FlowHooksOf('tools:call-tool');
```

`FlowHooksOf(flowName)` returns an object with all five decorator factories bound to the specified flow.

### `@Did` Runs on Success, `@Finally` Always Runs

A stage runs its `@Will` hooks, then its body (wrapped by its `@Around` hooks), then its `@Did` hooks, then its `@Finally` hooks.

- `@Did` runs only when the stage succeeded. When a `@Will` hook, the body or an `@Around` hook fails, the stage's `@Did` hooks are skipped. So a `@Did` hook that closes what a `@Will` hook opened (a span, a timer, a lock) leaks it on every failure.
- `@Finally` runs after the stage on every outcome: when it succeeded or responded, when it failed, when a `@Will` hook failed or responded in its place, when an `@Around` hook failed, and when `finalize` refused an answer the tool's output schema rejects (`InvalidOutputError`). Read the failure from `ctx.error`: the first error the run failed with (what a stage or hook threw or passed to `ctx.fail()`; a `FlowControl.abort(reason)` reads as `Flow aborted: <reason>`), `undefined` while the run has none. `ctx.error` reads `ctx.state.flowError`, which the state types only on `tools:call-tool`, `resources:read-resource`, `prompts:get-prompt` and `jobs:execute-job`; `ctx.error` is typed on every flow.
- A `@Finally` hook cannot change the outcome. If it calls `ctx.respond()` or `ctx.fail()`, or throws, the flow logs a warning and goes on as if it had not: the client gets the same answer or the same error, the values the hook set on `ctx.state` before it responded, failed or threw are put back (a job's answer, for one; an object it changed in place is not), and the stage's other `@Finally` hooks still run. A `@Finally` hook that returns normally keeps what it set on `ctx.state`, like any other hook: on `jobs:execute-job`, setting `state.answer` before `updateRunState` changes the result the run records and returns.
- `@Finally` hooks of one stage run in `priority` order, lowest first, like every other hook (see [Hook Order](#hook-order)). A stage the flow never reaches (because an earlier stage failed) runs none of its hooks, `@Finally` included: hook `finalize` to see the end of every call.

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Finally } = ToolHook;

@Plugin({ name: 'execute-timer' })
export class ExecuteTimerPlugin {
  private readonly startedAt = new WeakMap<FlowCtxOf<'tools:call-tool'>, number>();

  @Will('execute')
  start(ctx: FlowCtxOf<'tools:call-tool'>) {
    this.startedAt.set(ctx, Date.now());
  }

  @Finally('execute')
  stop(ctx: FlowCtxOf<'tools:call-tool'>) {
    const startedAt = this.startedAt.get(ctx);
    if (startedAt === undefined) return;
    const outcome = ctx.error ? `failed: ${ctx.error.message}` : 'succeeded';
    ctx.logger.info(`execute ${outcome} in ${Date.now() - startedAt}ms`);
  }
}
```

Up to 1.10.15 there was no `@Finally`: a failure in `finalize` (an output schema refusing the answer) skipped the stage's `@Did` hooks and left `state.flowError` unset. `ctx.error` is new in 1.10.16.

### What `@Stage` Does

A `@Stage('execute')` hook does not replace the flow's own `execute` step: it adds a step to that stage, and the flow's own step still runs. The steps of a stage run in `priority` order (lower first). At equal priority, a plugin's or provider's step runs before the flow's own step, and a step declared on a `@Tool` class runs after it (see [Hook Order](#hook-order)). The value a `@Stage` method returns is ignored.

To keep the flow's own step from running:

- Call `ctx.respond(result)` from the `@Stage` (or a `@Will`) hook. The flow ends with that result: it skips the rest of the stage and the main stages after it, while the stage's `@Finally` hooks (and its `@Did` hooks, when a `@Stage` hook answered) and the cleanup stages (in `tools:call-tool`: `releaseSemaphore`, `releaseQuota`, `applyUI`, `finalize`, `fitAnswer`, `shapeAnswer`, `meterAnswer`) still run. In `tools:call-tool`, `result` is a complete MCP `CallToolResult`; it does not go through the tool's output schema.
- Or use an `@Around` hook that does not call `next()`. The stage is skipped and the flow goes on; in `tools:call-tool`, set `ctx.state.required.toolContext.output`, and the result is validated and formatted like the tool's own.

Each answer the flow sends, the tool's from `finalize` or a hook's `ctx.respond(result)` (an `@Around('finalize')` hook that replaces it after `next()` included), becomes `ctx.state.output` in `tools:call-tool` and `resources:read-resource`. The stages after `finalize` work on it: `fitAnswer` (`output.budget`), `shapeAnswer` (`clients` profiles) and `meterAnswer` (the `/metrics` answer cost). Hook `Did('meterAnswer')` to see the answer the client receives.

These stages shape only a client's answer, not the one a tool gets from `this.callTool()`; a hook on them checks the same with `ctx.isClientCall()`. A `Will('fitAnswer')` hook that answers with `ctx.respond(result)` replaces the answer before the budget fits it, as `@frontmcp/plugin-result-handles` does to fold a large answer (see `result-handles-plugin`).

## Hook Order

Hooks on one stage run in `priority` order, **lowest first**; the default is `0`, and a higher number does not run earlier. A stage runs its `@Will` hooks, then its steps (the flow's own step and the `@Stage` hooks) wrapped by its `@Around` hooks, then its `@Did` hooks, then its `@Finally` hooks, each list in `priority` order.

One exception: an entry class's (`@Tool`, `@Resource`, `@Prompt`, `@Agent`, `@Job`) instance `@Stage` hooks on the stage that builds its instance (`createToolCallContext`, `createResourceContext`, `createPromptContext`, `createAgentContext`, `createJobContext`) join while that stage's own step runs, so none of them runs before that step: one whose priority would place it before the step runs right after it, and the others keep their place by priority. The hook order print lists them where they run.

- **Ties.** At equal priority, the hooks of plugins and providers run in the order they were registered (an app's plugins in the order its `plugins` array lists them), then the flow's own step, then the hooks declared on the entry class (`@Tool`, `@Resource`, `@Prompt`, `@Agent`, `@Job`): its `static` hooks, then its instance hooks.
- **Around nesting.** The `@Around` hook with the lowest priority is the outermost: its code before `next()` runs first and its code after `next()` runs last. The `@Around` hooks of a stage wrap all of its steps, but not its `@Will`, `@Did` or `@Finally` hooks.

Two plugins on the same stage, where the feature gate must refuse before the setup gate runs:

```typescript
import { App, FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

@Plugin({ name: 'setup-gate' })
export class SetupGatePlugin {
  @ToolHook.Will('execute', { priority: 10 })
  requireSetup(ctx: FlowCtxOf<'tools:call-tool'>) {
    // refuse when the account is not set up
  }
}

@Plugin({ name: 'feature-gate' })
export class FeatureGatePlugin {
  @ToolHook.Will('execute', { priority: -10 })
  refuseDisabled(ctx: FlowCtxOf<'tools:call-tool'>) {
    // refuse when the feature is disabled
  }
}

@App({ name: 'billing', plugins: [SetupGatePlugin, FeatureGatePlugin], tools: [InvoiceTool] })
export class BillingApp {}
```

`refuseDisabled` (`-10`) runs before `requireSetup` (`10`), though its plugin is listed second. At equal priorities, `requireSetup` would run first, because its plugin is listed first.

### Named Bands: `HookPhase`

`HookPhase` names the priorities of what a hook does on its stage, in run order. Use them instead of picking numbers, and add to one to run between two bands (`HookPhase.guard + 10`):

| Band                | Priority | For hooks that                                                         |
| ------------------- | -------- | ---------------------------------------------------------------------- |
| `HookPhase.resolve` | `-100`   | fill in what later hooks read: a resolved name, a tenant, defaults     |
| (default)           | `0`      | everything else                                                        |
| `HookPhase.guard`   | `100`    | refuse a call: approval, feature flags, a setup gate                   |
| `HookPhase.observe` | `300`    | watch a call the guards let through: timing, audit                     |
| `HookPhase.shape`   | `500`    | rewrite what the stage hands on, such as folding or trimming an answer |

The built-in plugins keep their priorities: the approval check runs at `HookPhase.guard` (`100`), the feature-flag gates at `50` (just before it), CodeCall's refusal of a hidden tool on `Did('findTool')` at `10`, and the cache plugin at `1000`, after every band (a cached answer is served only once every guard ran). The observability plugin opens its spans in `@Will` hooks at `-1000` and closes them in `@Did` and `@Finally` hooks at `1000`, outside every band, so its spans cover all of them.

```typescript
import { HookPhase, Plugin, ToolHook } from '@frontmcp/sdk';

@Plugin({ name: 'setup-gate' })
export class SetupGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard + 10 })
  requireSetup() {
    // runs after approval, at HookPhase.guard
  }
}
```

### Ordering Against Another Hook: `before` and `after`

When a hook must run before or after a particular plugin, say so instead of choosing a number on the other side of its priority:

```typescript
@Plugin({ name: 'feature-gate' })
export class FeatureGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard, before: ['setup-gate'] })
  refuseDisabled(ctx: FlowCtxOf<'tools:call-tool'>) {
    // refuse when the feature is disabled, before the setup gate asks for setup
  }
}
```

- **Targets.** Each entry of `before` or `after` is the `name` of a plugin (`'setup-gate'`), or the name of the class that declares the hook (`'SetupGatePlugin'`, a provider or an entry class such as `'InvoiceTool'`), naming every hook it has on the stage; add `.method` to name one (`'setup-gate.requireSetup'`). Prefer the plugin name: a bundler that minifies class names changes the class name, not the plugin's.
- **Scope.** A constraint relates hooks of the same flow, stage and type: a `@Will('execute')` hook's `before` orders it among the `@Will('execute')` hooks. The flow's own steps are not hooks and cannot be named.
- **Precedence.** Constraints come first, then priority, then registration order. The hook that declares a constraint is the one that moves: with `before`, it takes the place of the earliest hook it names; with `after`, it waits until the hooks it names have run. The hooks it names, and every hook no constraint relates, keep their priority order, so an `observe` hook with `before: ['tenant-resolver']` runs just ahead of the resolver and never pulls a `guard` hook ahead of it. For `@Around` hooks, `before` makes the hook wrap its target, `after` makes it run inside it.
- **Errors.** Constraints that form a cycle (`a` before `b`, `b` before `a`) stop the server at startup with a `HookOrderCycleError` (code `HOOK_ORDER_CYCLE`) that names the hooks in the cycle, in its message and in `hooks`. The check relates the hooks one call can run together: all of a scope's plugin, provider and app hooks (a call naming an unknown tool runs every app's), with the ones an agent inherits through `execution.inheritPlugins`, and the hooks of one entry class at a time, since two entry classes never share a call. A target that matches no hook on the stage logs one warning at startup (`Hook feature-gate.refuseDisabled (will 'execute' of 'tools:call-tool') names 'setup-gate' in before, but no hook on that stage matches it, so it changes nothing. ...`), and the hook keeps its place by priority. A constraint never relates a hook to itself, or to another instance of the same hook (the same plugin installed on two apps).
- **Validation.** `before` and `after` must be arrays of non-empty strings with no surrounding spaces, and `appliesTo` one of its values: anything else throws `InvalidDecoratorMetadataError` where the hook is declared.

### Seeing the Resolved Order

With `NODE_ENV=development`, or `DEBUG=1`, a flow logs at info level the order its hooks resolve to, on its first run for each hook owner (the app of the entry the run is for) and for each entry class that declares hooks of its own. It is logged once, not per request, and nothing is built for it unless the server runs in dev mode or with `DEBUG` set. Each line is a stage that has hooks, with its steps in the order they run, as `type Class.method (priority)`, followed by the step's `before` and `after` when it has some; an `@Around` hook's brackets hold what it wraps:

```text
[FlowInstance] INFO Hook order of 'tools:call-tool' for 'billing', lowest priority first (an around hook wraps what its brackets hold):
  execute: will FeatureGatePlugin.refuseDisabled (100, before setup-gate) → will SetupGatePlugin.requireSetup (110) → stage CallToolFlow.execute (0)
```

The print is new in 1.10.16; its `before` and `after`, `HookPhase`, the hook trace below and `appliesTo: 'all-apps'` are new in 1.11.

### Tracing a Call in Dev Mode: `_meta['frontmcp/trace']`

With `NODE_ENV=development`, every tool, resource and prompt answer carries the hooks that ran for the call in `_meta['frontmcp/trace']` (`HOOK_TRACE_META_KEY`), in the order they started:

```json
{
  "frontmcp/trace": [
    {
      "owner": "feature-gate",
      "method": "refuseDisabled",
      "stage": "execute",
      "type": "will",
      "ms": 0.041,
      "outcome": "ok"
    },
    {
      "owner": "setup-gate",
      "method": "requireSetup",
      "stage": "execute",
      "type": "will",
      "ms": 0.012,
      "outcome": "ok"
    }
  ]
}
```

- `owner` is the plugin's `name`, else the name of the class that declares the hook; `outcome` is `ok`, `respond`, `fail`, `abort`, `next`, `handled` or `error` (a thrown `Error`). An `@Around` hook's `ms` includes what it wraps.
- It lists the hooks of plugins, providers, apps and entry classes, not the flow's own steps, and never a hook's arguments, the call's input or its answer.
- It is added once the answer is final, after the answer budget (`output.budget`) and the cost meter, so neither counts it and an answer is fitted the same with or without it.
- `@FrontMcp({ devtools: { hookTrace: true } })` turns it on outside dev mode (a staging server, say), and `hookTrace: false` turns it off in dev mode. A value that is not a boolean stops the server at startup. Outside dev mode, without `hookTrace: true`, answers never carry it.

### Watching Every Hook: Hook Observers

The trace is built by a hook observer, a function that wraps every hook a request runs (`hook.stage` is the key the hook runs under, such as `willExecute`). Add one to a request's `FrontMcpContext` with `addHookObserver()`, from a hook that runs early in the request (for HTTP, `http:request` runs first):

```typescript
import { addHookObserver, FRONTMCP_CONTEXT, HttpHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

@Plugin({ name: 'hook-timer' })
export class HookTimerPlugin {
  @HttpHook.Will('traceRequest', { priority: -2000 })
  watch(ctx: FlowCtxOf<'http:request'>) {
    addHookObserver(ctx.get(FRONTMCP_CONTEXT), async (hook, run) => {
      const startedAt = performance.now();
      try {
        await run();
      } finally {
        console.log(
          `${hook.owner}.${hook.method} on ${hook.flowName}:${hook.stage}: ${performance.now() - startedAt}ms`,
        );
      }
    });
  }
}
```

Every observer wraps the hook, the first added outermost; the observability plugin adds its own (request logs' `hooks_triggered`, `tracing.hookSpans`) next to any other. Whatever an observer does, the hook runs once and settles as it would unobserved: what an observer throws is logged once, as a warning, and ignored. Up to 1.10, a request had a single observer slot, and a second observer was dropped.

## Available Flow Names

These are the flow names with pre-built hook decorator exports in `@frontmcp/sdk` (see "Pre-Built Hook Type Exports" below):

| Flow Name                           | Description               | Pre-built export            |
| ----------------------------------- | ------------------------- | --------------------------- |
| `tools:call-tool`                   | Tool execution            | `ToolHook`                  |
| `tools:list-tools`                  | Tool listing / discovery  | `ListToolsHook`             |
| `http:request`                      | HTTP request handling     | `HttpHook`                  |
| `resources:read-resource`           | Resource reading          | `ResourceHook`              |
| `resources:list-resources`          | Resource listing          | `ListResourcesHook`         |
| `resources:list-resource-templates` | Resource template listing | `ListResourceTemplatesHook` |
| `prompts:get-prompt`                | Prompt retrieval          | `PromptHook`                |
| `prompts:list-prompts`              | Prompt listing            | `ListPromptsHook`           |
| `completion:complete`               | Argument completion       | `CompletionHook`            |
| `agents:call-agent`                 | Agent invocation          | `AgentCallHook`             |
| `jobs:execute-job`                  | One attempt of a job      | `JobHook`                   |
| `channels:send-notification`        | Channel notification send | `ChannelSendHook`           |
| `channels:list`                     | Channel listing           | `ChannelListHook`           |

Every other built-in flow is hooked with `FlowHooksOf('<name>')`, and its name typechecks: `session:verify`, `auth:verify`, `handle:mcp-202607280728`, `handle:streamable-http`, `handle:legacy-sse`, `handle:stateless-http`, `http:ip-filter`, `elicitation:request`, `elicitation:result`, `logging:set-level`, `resources:subscribe`, `resources:unsubscribe`, `skills:search`, `skills:load`, `skills:filter`, `well-known.jwks`, `well-known.oauth-protected-resource`, `well-known.oauth-authorization-server` and the `oauth:*` flows. `logging/setLevel`, `resources/subscribe`, `resources/unsubscribe`, `skills/search` and `skills/load` requests run their flows, so hooks on them fire (up to 1.9.2 those requests skipped them, and several of these names were missing from the published `ExtendFlows`, so `FlowHooksOf()` rejected them).

## Strict architecture: flows are the only path — never bypass them

This is the load-bearing invariant behind every hook above: in FrontMCP **every
request runs through a flow**, and because flows are made of `@Stage` steps that
`FlowHooksOf` exposes for interception, hooks work _everywhere_ automatically.
The hookability is only guaranteed because nothing handles a request outside a
flow.

Therefore:

- **Never bypass the flow pipeline to make something work.** Add or extend a flow
  - its stages; do not hand-roll request logic (auth, transport, routing) in a
    transport/adapter that skips the flow. A bypass silently deletes every hook on
    that path.
- **Adapters only translate.** A transport adapter (Express, the Web-fetch/worker
  handler, stdio) converts its native request/response to the flow's normalized
  `ServerRequest` + `httpRespond` output and then runs the **same** flows. Two
  adapters must never diverge in behavior (e.g. one enforcing auth, another not).
- **Fix runtime gaps in the flow, not around it.** If a flow stage can't run in a
  target runtime (e.g. a stage needs a Node `ServerResponse` but a Worker only has
  Web `Request`/`Response`), make the stage runtime-agnostic (emit normalized
  output each adapter renders) — do not write a runtime-specific shortcut that
  skips the flow.
- **Cross-cutting concerns are stages, not inlined code.** Auth, quota, audit,
  metrics belong to flow stages (so they're hookable), never re-implemented inside
  an adapter.
- **Use `FlowInputOf` / `FlowOutputOf`**, never ad-hoc `as { … }` casts on flow
  results — a cast is a sign you're working around the flow instead of with it.

If a change handles a request without going through a flow, or inlines a
cross-cutting concern, it's wrong — rework it through a hookable flow.

## Server Lifecycle Hooks

Besides flow hooks, the scope (`ScopeEntry`) takes two lifecycle callbacks:

- **`scope.onServerStarted(callback: () => void | Promise<void>): void`** runs `callback` after the HTTP server starts listening, in `FrontMcpInstance.start()`. Callbacks run in registration order, each awaited. It never fires in direct mode (`create()`, `createDirect()`, `connect()`), where no HTTP server starts.
- **`scope.onDispose(callback: () => void | Promise<void>): () => void`** runs `callback` when the scope is disposed: on `SIGTERM`/`SIGINT` for an HTTP, Unix socket or stdio server, and in direct mode too. Callbacks run once, in reverse order of registration, each awaited; the shutdown deadline (5s under stdio, 10s otherwise) still exits a process whose callback hangs. The returned function removes the callback.

Use them for warming caches, starting background indexing, or releasing timers and connections. A plugin reaches the scope from a factory provider: `ScopeEntry` is a DI token, so `inject: () => [ScopeEntry]` hands the factory the scope it is built in. The plugin's providers are built while the server starts up, before it listens, so the callback is registered in time.

A provider can also implement `onBootstrap()`, `onReady()` and `onShutdown()` itself, a plugin's providers included; see `create-provider` (Provider Lifecycle). `onReady()` runs on every transport, stdio and direct mode included, where `onServerStarted()` does not.

```typescript
import { Plugin, ScopeEntry } from '@frontmcp/sdk';

export class ReportCache {
  private readonly reports = new Map<string, string>();

  async warm(): Promise<void> {
    this.reports.set('daily', await loadDailyReport());
  }

  get(name: string): string | undefined {
    return this.reports.get(name);
  }

  clear(): void {
    this.reports.clear();
  }
}

const reportCacheProvider = {
  name: 'cache-warmer:report-cache',
  provide: ReportCache,
  inject: () => [ScopeEntry],
  useFactory: (scope: ScopeEntry) => {
    const cache = new ReportCache();
    scope.onServerStarted(() => cache.warm());
    scope.onDispose(() => cache.clear());
    return cache;
  },
};

@Plugin({
  name: 'cache-warmer',
  description: 'Warms the report cache once the server is listening',
  providers: [reportCacheProvider],
  exports: [reportCacheProvider],
})
export class CacheWarmerPlugin {}
```

Listing the provider in `exports` too lets the app's tools resolve the cache with `this.get(ReportCache)`; `exports` takes provider definitions, not bare tokens. Inside a tool, resource or prompt, the scope itself is `this.scope`. Inside a flow hook, resolve it with `ctx.get(ScopeEntry)` (for example `ctx.get(ScopeEntry).apps.getApps()` in a server-scoped plugin): the flow's own `scope` is protected. To tell clients a list changed, a hook calls `ctx.notify.listChanged('tools')` (see [What a Hook Receives](#what-a-hook-receives)). See [Scope lifecycle hooks](https://frontmcp.dev/reference/sdk/scope).

## Pre-Built Hook Type Exports

For convenience, FrontMCP exports typed aliases so you do not need to call `FlowHooksOf` directly:

```typescript
import {
  AgentCallHook, // FlowHooksOf('agents:call-agent')
  ChannelListHook, // FlowHooksOf('channels:list')
  ChannelSendHook, // FlowHooksOf('channels:send-notification')
  CompletionHook, // FlowHooksOf('completion:complete')
  HttpHook, // FlowHooksOf('http:request')
  JobHook, // FlowHooksOf('jobs:execute-job')
  ListPromptsHook, // FlowHooksOf('prompts:list-prompts')
  ListResourcesHook, // FlowHooksOf('resources:list-resources')
  ListResourceTemplatesHook, // FlowHooksOf('resources:list-resource-templates')
  ListToolsHook, // FlowHooksOf('tools:list-tools')
  PromptHook, // FlowHooksOf('prompts:get-prompt')
  ResourceHook, // FlowHooksOf('resources:read-resource')
  ToolHook, // FlowHooksOf('tools:call-tool')
} from '@frontmcp/sdk';
```

Usage:

```typescript
const { Will, Did, Around, Finally, Stage } = ToolHook;
```

> **Note:** Other flows (e.g., `skills:filter`, transport flows) can be hooked by passing the flow name to `FlowHooksOf('flow:name')`. Prefer the pre-built exports above when one is available: exporting them is also what puts a flow's types in the published package, which is why `FlowHooksOf('prompts:get-prompt')`, `'prompts:list-prompts'` and `'completion:complete'` did not typecheck in consumer projects up to 1.8.7.

## call-tool Flow Stages

The main stages of the `tools:call-tool` flow, in order (the full list is under [Available Stages for Tool Hooks](#available-stages-for-tool-hooks)):

1. **parseInput** - Parse the MCP request; sets `state.input` (the tool `name` and `arguments`) and `state.authInfo`
2. **findTool** - Look up the tool in the registry; sets `state.tool`
3. **checkToolAuthorization** - Verify the caller is authorized
4. **createToolCallContext** - Build the ToolContext instance; sets `state.toolContext`
5. **validateInput** - Validate input against the Zod schema
6. **execute** - Run the tool's `execute()` method; its result is `state.toolContext.output`
7. **validateOutput** - Record the result as `state.rawOutput`
8. **finalize** - Validate the result against the output schema and send the MCP response

## What a Hook Receives

A hook method on a plugin or provider receives the running flow as its first argument; type it `FlowCtxOf<'<flow-name>'>`. An `@Around` hook also receives `next`. `this` is the plugin or provider instance.

The decorator checks that parameter against the flow it hooks. `FlowCtxOf<'<flow-name>'>`, a structural subset of it (`ctx: { toolName: string }`), `unknown`, or no parameter compiles. A parameter with a property the flow does not have (or keeps protected, such as `input` or `scope`), a property of the wrong type, the ctx of another flow, or a second parameter on a hook other than `@Around` fails to compile, with `TS1241: Unable to resolve signature of method decorator when called as an expression` and a last line naming the property, such as `Property 'notAField' is missing in type 'CallToolFlow'`. Up to 1.10.15 the decorators did not check the parameter: a hook typed `ctx: { toolName: string }` compiled, read `undefined` and silently never matched. A hook decorator is a `FlowHookDecorator`, not a `MethodDecorator`: a helper that returns one leaves its return type inferred.

| Member            | Description                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`           | The flow's state, typed per flow: read `ctx.state.tool` (or `ctx.state.required.tool`, which throws when unset), write with `ctx.state.set(key, value)` |
| `rawInput`        | The input the flow was started with; for `tools:call-tool`, the MCP `request` and its `ctx`                                                             |
| `logger`          | The flow's logger (the tool, resource and prompt flows define one; every flow has `scopeLogger`)                                                        |
| `get(token)`      | Resolves a provider registered on the server, or a context-scoped provider of the current call                                                          |
| `respond(output)` | Ends the flow with this output (ignored in a `@Finally` hook)                                                                                           |
| `fail(error)`     | Ends the flow with this error (an `Error`, such as an MCP error class; ignored in a `@Finally` hook)                                                    |
| `request`         | The request the run serves: `sessionId`, `clientInfo`, `metadata`, `protocol` (see below); each `undefined` when the run has none                       |
| `notify`          | `notify.listChanged('tools' \| 'resources' \| 'prompts')` sends `notifications/<kind>/list_changed` to every connected session                          |
| `error`           | The first failure of the run (`state.flowError`), for the stages and `@Finally` hooks after it; `undefined` while the run has none                      |

The entry flows also name their entry:

| Flow                      | Member       | Description                                                                                                                          |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tools:call-tool`         | `toolName`   | The tool's name (its `id`, else its `name`) once `findTool` resolved it, else the name the call asks for                             |
| `tools:call-tool`         | `toolInput`  | The arguments the call passes to the tool (`state.input.arguments`, as `@Will` hooks left them), before its input schema parses them |
| `resources:read-resource` | `uri`        | The URI the read asks for                                                                                                            |
| `prompts:get-prompt`      | `promptName` | The prompt's name: the one `findPrompt` resolved, else the name the request asks for                                                 |

`ctx.request` holds:

- `sessionId`: the session the server verified for the request; `undefined` for a request without one (the stateless transports, MCP 2026-07-28, an `mcp-session-id` the server did not accept).
- `clientInfo`: the client's `name` and `version`, sent with the request (MCP 2026-07-28 `_meta`) or at its session's `initialize`.
- `metadata`: the request's `userAgent`, `contentType`, `accept`, `clientIp` and `customHeaders` (its `x-frontmcp-*` headers, and those `http.forwardHeaders` keeps).
- `protocol`: the transport the session was opened over (`'streamable-http'`, `'legacy-sse'`, ...), when the session records it; an anonymous session (`auth.mode: 'public'`) does not.

The flow has no `elapsed` or `tryGet`, and its `input`, `scope` and `tryGetContext()` are protected: read the request through `ctx.request`. In `tools:call-tool`, the tool entry is `ctx.state.tool` (set by `findTool`) and the tool instance `ctx.state.toolContext` (set from `createToolCallContext` on); to rewrite the call's name or arguments, set `ctx.state.input`. The state accepts only the keys the flow declares: `ctx.state.set('startedAt', Date.now())` does not compile.

### Reading the Request and Announcing a List Change

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'client-audit' })
export class ClientAuditPlugin {
  @Will('execute', { filter: (ctx) => ctx.toolName !== 'health_check' })
  logCaller(ctx: FlowCtxOf<'tools:call-tool'>) {
    const { clientInfo, sessionId, metadata } = ctx.request;
    ctx.logger.info(`${clientInfo?.name ?? 'An unknown client'} called ${ctx.toolName}`, {
      sessionId,
      userAgent: metadata?.userAgent,
      arguments: ctx.toolInput,
    });
  }

  @Did('execute', { filter: (ctx) => ctx.toolName === 'install_extension' })
  announceNewTools(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.notify.listChanged('tools');
  }
}
```

`notify.listChanged()` reaches every session connected to the server, over the transports that keep a session (streamable HTTP with its `GET` stream, legacy SSE, stdio, `connect()`); a client without a session (stateless HTTP, MCP 2026-07-28) receives nothing. Up to 1.10.15 a hook reached the request only through `ctx.get(FRONTMCP_CONTEXT)` and the notifications through `ctx.get(ScopeEntry).notifications`.

### Sharing Data Between Hooks

A plugin is created once and serves every call, so a value kept on `this` is shared by concurrent calls. To carry a value through one call:

- Within one stage, use an `@Around` hook: a local variable lives across `await next()`.
- Across hooks, key the value on the flow in a `WeakMap`. Each call runs its own flow instance, every hook of the call receives that same instance, and the entry goes away with it.

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'timing' })
export class TimingPlugin {
  private readonly startedAt = new WeakMap<FlowCtxOf<'tools:call-tool'>, number>();

  @Will('validateInput')
  start(ctx: FlowCtxOf<'tools:call-tool'>) {
    this.startedAt.set(ctx, Date.now());
  }

  @Did('validateOutput')
  stop(ctx: FlowCtxOf<'tools:call-tool'>) {
    const startedAt = this.startedAt.get(ctx);
    if (startedAt !== undefined) {
      ctx.logger.info(`Tool "${ctx.toolName}" took ${Date.now() - startedAt}ms`);
    }
  }
}
```

## HookOptions

All five decorators accept an optional options object:

```typescript
@Will('execute', {
  priority: HookPhase.guard, // Lower runs first (default: 0)
  before: ['setup-gate'], // Runs before these hooks of the stage, whatever their priority
  after: ['tenant-resolver.resolve'], // Runs after these
  filter: (ctx) => ctx.toolName !== 'health_check', // Predicate to skip
  appliesTo: 'own-app', // Reach of an app plugin's hook (default: 'own-app')
})
```

- **priority** (`number`) - Execution order when multiple hooks target the same stage. Lower values run first, for `@Will`, `@Did`, `@Around`, `@Finally` and `@Stage` alike, and the lowest `@Around` is the outermost. Default: `0`. Use the [`HookPhase`](#named-bands-hookphase) bands rather than bare numbers. Ties and an example: [Hook Order](#hook-order).
- **before** / **after** (`string[]`) - Plugin names or class names, each optionally followed by `.method`, of the hooks of the same stage and type this one runs before or after. They take precedence over `priority`; a cycle stops the server at startup and a target that matches nothing logs a warning. See [Ordering Against Another Hook](#ordering-against-another-hook-before-and-after).
- **filter** (`(ctx) => boolean`) - A predicate that receives the flow context, typed like the hook's (`ctx.toolName`, `ctx.request`, ...). Return `false` to skip this hook for the current invocation.
- **appliesTo** (`'own-app' | 'uncovered-apps' | 'all-apps'`) - A hook of a plugin installed on an app runs, in `tools/call`, `resources/read`, `prompts/get` and `completion/complete`, only for that app's entries (`'own-app'`), unless the plugin has `scope: 'server'`. Server-level plugins' hooks, and list-flow hooks, already run for every app.
  - `'uncovered-apps'`: it also runs for the entries of any app that has no instance of the same hook (same class and method) of its own or from a server-level plugin. Use it for gates an entry's metadata asks for (approval, feature flags), so the entry is not left ungated when the plugin sits on another app, while an app that installs the gate itself keeps its own instance.
  - `'all-apps'`: it runs for the entries of every app, and the tools the server declares, like a server-level plugin's hook, even for an app with its own instance of the same hook (then both run). Use it for one hook that guards or watches every app, such as a setup gate, while the plugin and its other hooks stay on the app that installs it. Such a hook reads, and can change, every app's calls (their arguments and answers, remote apps' included), so grant it only to a plugin you would install on the server.
  - `@Plugin({ scope: 'server' })` instead makes every hook of the plugin run for every app, and a standalone app cannot install it (`InvalidPluginScopeError`). Both reach only the apps that share a scope with the app that installs the plugin: a standalone app, or each app of a `splitByApp` server, is a scope of its own. A plugin installed on the server (`@FrontMcp({ plugins })`) reaches every scope.

## Examples

### Logging Plugin

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'logging-plugin' })
export class LoggingPlugin {
  @Will('execute', { priority: -100 })
  logBefore(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.logger.info(`Tool "${ctx.toolName}" called`, ctx.toolInput);
  }

  @Did('execute')
  logAfter(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.logger.info(`Tool "${ctx.toolName}" completed`);
  }
}
```

### Authorization Check Plugin

```typescript
import { FlowCtxOf, Plugin, ToolHook, UnauthorizedError } from '@frontmcp/sdk';

const { Will } = ToolHook;

@Plugin({ name: 'auth-check-plugin' })
export class AuthCheckPlugin {
  @Will('checkToolAuthorization', { priority: 50 })
  requireAdminScope(ctx: FlowCtxOf<'tools:call-tool'>) {
    const scopes = ctx.state.authInfo?.scopes ?? [];
    if (!scopes.includes('admin')) {
      ctx.fail(new UnauthorizedError('Unauthorized: admin scope required'));
    }
  }
}
```

### Caching Plugin with @Around

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Around } = ToolHook;

@Plugin({ name: 'cache-plugin' })
export class CachePlugin {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  @Around('execute', { priority: 90 })
  async cacheResults(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>) {
    const key = `${ctx.toolName}:${JSON.stringify(ctx.toolInput)}`;
    const toolContext = ctx.state.required.toolContext;
    const cached = this.cache.get(key);

    if (cached && cached.expiry > Date.now()) {
      toolContext.output = cached.data;
      return; // not calling next() skips the execute stage
    }

    await next(); // resolves with no value; the result is on toolContext.output

    this.cache.set(key, {
      data: toolContext.output,
      expiry: Date.now() + 60_000,
    });
  }
}
```

### Ending the Flow from a @Stage Hook

The hook joins the `execute` stage and runs before the tool's own step. Its `ctx.respond()` ends the flow, so the tool's `execute()` does not run for `fetch_weather`; every other tool runs as usual. Returning a value instead would change nothing: the return value is ignored and the tool would still run.

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Stage } = ToolHook;

@Plugin({ name: 'mock-plugin' })
export class MockPlugin {
  @Stage('execute', {
    filter: (ctx) => ctx.toolName === 'fetch_weather',
  })
  mockWeather(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.respond({ content: [{ type: 'text', text: '72F and sunny' }] });
  }
}
```

To give a mocked result that goes through the tool's output schema, use an `@Around('execute')` hook that sets `ctx.state.required.toolContext.output` and does not call `next()`, as the caching plugin above does on a hit.

## Registering Plugins

Register plugins in your `@App` decorator:

```typescript
import { App } from '@frontmcp/sdk';

import { CachePlugin } from './plugins/cache.plugin';
import { LoggingPlugin } from './plugins/logging.plugin';

@App({
  name: 'my-app',
  plugins: [LoggingPlugin, CachePlugin],
})
export class MyApp {}
```

Plugins are initialized in array order. Hook priority determines execution order within the same stage, lowest first; at equal priority, hooks run in array order (see [Hook Order](#hook-order)).

Hooks declared on an app's providers, on its plugins (including plugins nested inside them), and on those plugins' providers run only for that app's tools, resources and prompts (`tools:call-tool`, `resources:read-resource`, `prompts:get-prompt`, `completion:complete`), including the ones its adapters and plugins provide, such as the tools an OpenAPI adapter generates, unless the hook sets [`appliesTo`](#hookoptions). Plugins and providers registered on the server (`@FrontMcp({ plugins, providers })`) apply to every app. So do the hooks of a plugin declared with `scope: 'server'`, those on its providers included, even when it is installed on one app; its providers and context extensions still stay with that app, and each app that installs it adds another copy of its hooks that runs for every app. Up to 1.9.0 those hooks ran only for the installing app. Resources and prompts the server serves outside every app, such as the SEP-2640 `skill://` resources, run every app's hooks.

A hook declared on a `CONTEXT`-scoped provider (`@Provider({ name, scope: ProviderScope.CONTEXT })`, a class provider) runs on the instance built for the request or session -- the same instance the request's tools get from `this.get()`. Up to 1.8.7, hooks on server-level and `CONTEXT`-scoped providers were never registered.

## Using Hooks Inside a @Tool Class

You can add hook methods directly on a `@Tool` class to intercept its own execution flow. The hooks apply only when **this tool** is called:

```typescript
import { Tool, ToolContext, ToolHook, ToolInputOf, z } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

const inputSchema = {
  orderId: z.string(),
  amount: z.number(),
};

type ProcessOrderInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;

@Tool({
  name: 'process_order',
  description: 'Process a customer order',
  inputSchema,
  outputSchema: { status: z.string(), receipt: z.string() },
})
class ProcessOrderTool extends ToolContext {
  // Runs BEFORE execute — validate, enrich input, check preconditions
  @Will('execute', { priority: 10 })
  async beforeExecute() {
    // A hook has no `input` parameter: `this.input` is the validated input, typed through the schema
    const { orderId } = this.input as ProcessOrderInput;
    const db = this.get(DB_TOKEN);
    const order = await db.findOrder(orderId);
    if (!order) {
      this.fail(new Error(`Order ${orderId} not found`));
    }
    if (order.status === 'completed') {
      this.fail(new Error('Order already processed'));
    }
    this.mark('validated');
  }

  // Main execution
  async execute(input: ProcessOrderInput) {
    const payment = this.get(PAYMENT_TOKEN);
    const receipt = await payment.charge(input.orderId, input.amount);
    return { status: 'completed', receipt: receipt.id };
  }

  // Runs AFTER execute — log, notify, cleanup
  @Did('execute')
  async afterExecute() {
    const analytics = this.tryGet(ANALYTICS_TOKEN);
    if (analytics) {
      const { orderId, amount } = this.input as ProcessOrderInput;
      await analytics.track('order_processed', { orderId, amount });
    }
  }
}
```

### How Tool-Level Hooks Work

- `@Will('execute')` on a tool class runs **before** the `execute()` method of that specific tool
- `@Did('execute')` runs **after** `execute()` completes successfully
- `@Finally('execute')` runs **after** `execute()` whether it succeeded or failed
- `@Will('validateInput')` runs before input validation — useful for input enrichment
- `@Did('validateOutput')` runs after output validation — useful for output transformation
- The hook has full access to `this` (the tool context) including `this.input`, `this.get()`, `this.fail()`

### Available Stages for Tool Hooks

```
parseInput → ensureRemoteCapabilities → findTool → checkToolAuthorization → checkEntryAuthorities
  → createTaskIfRequested → createToolCallContext → checkToolCredentials → acquireQuota → acquireSemaphore
  → validateInput → execute → validateOutput → releaseSemaphore → releaseQuota → applyUI → finalize
  → fitAnswer → shapeAnswer → meterAnswer
```

A tool-class hook declared as an instance method runs on the tool instance, which `createToolCallContext` builds. So it can hook `Did`/`Stage`/`Finally` on `createToolCallContext` and any hook on a later stage. The same holds for `@Resource` (`createResourceContext`), `@Prompt` (`createPromptContext`) and `@Agent` (`createAgentContext`) classes.

To hook an earlier stage (`parseInput`, `findTool`, `checkToolAuthorization`, `checkEntryAuthorities`, and `findResource`, `findPrompt`, `findAgent`, `checkAgentAuthorization`), declare the hook as a `static` method. It runs without an instance -- `this` is the class, and the flow context is its argument, as for every hook -- and joins only the calls for its own entry, from their first stage:

```typescript
@Tool({ name: 'transfer', inputSchema: { account: z.string(), amount: z.number() } })
class TransferTool extends ToolContext {
  @ToolHook.Will('checkToolAuthorization')
  static refuseFrozen(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    if (frozenAccounts.has(String(flowCtx.state.input?.arguments?.['account']))) {
      throw new UnauthorizedError('the account is frozen');
    }
  }

  async execute(input: { account: string; amount: number }) {
    return input;
  }
}
```

An instance method on an earlier stage, or `Will`/`Around` on `createToolCallContext`, fails startup with `InvalidHookFlowError` whose message says to make it `static`. A list-flow hook (`ListToolsHook`; listing builds no instance and runs for no single entry) fails startup whether static or not -- put it on a plugin or a provider. Up to 1.9.3 static hooks on earlier stages were refused too. A `@Job` class declares hooks for the `jobs:execute-job` flow its attempts run (`JobHook`), with the same rules: instance methods from `createJobContext` on, `static` methods for earlier stages; a hook for another flow fails startup (up to 1.9.3 any hook on a job class did). Up to 1.8.7 these hooks were accepted and silently never ran.

## Common Patterns

| Pattern               | Correct                                                               | Incorrect                                                              | Why                                                                                |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hook decorator source | `const { Will, Did } = ToolHook;` or `FlowHooksOf('tools:call-tool')` | Importing `Will` directly from `@frontmcp/sdk`                         | Decorators must be bound to a specific flow via `FlowHooksOf` or pre-built exports |
| Hook priority         | `@Will('execute', { priority: -100 })` for early hooks                | Relying on array order without priority                                | Multiple hooks on the same stage need explicit priority; lower runs first          |
| Around next()         | `await next();`                                                       | Forgetting to call `next()` in `@Around`                               | Omitting `next()` skips the wrapped stage; its `@Did` hooks still run              |
| Cleanup after a stage | `@Finally('execute')` closes the span or timer `@Will` opened         | Closing it in `@Did('execute')`                                        | `@Did` is skipped when the stage fails; `@Finally` runs on every outcome           |
| Around error recovery | `catch { ctx.state.required.toolContext.output = fallback; }`         | Catching a rejected `next()` without setting the output                | Returning normally handles the failure: the stage counts as successful             |
| Filter predicate      | `filter: (ctx) => ctx.toolName !== 'health_check'`                    | Checking tool name inside the hook body and returning early            | A filtered-out hook is skipped cleanly; for `@Around`, the stage still runs        |
| Hook parameter        | `ctx: FlowCtxOf<'tools:call-tool'>`, then `ctx.toolName`              | `ctx: { toolName: string }` copied from another flow's hook            | The decorator checks the parameter against the flow; the full type documents it    |
| Tool-level hooks      | `@Will('execute')` on a `@Tool` class (scoped to that tool)           | `@Will('execute')` on a `@Plugin` class expecting tool-scoped behavior | Plugin hooks fire for every tool of the app; tool-level hooks only for that tool   |

## Verification Checklist

### Configuration

- [ ] Hook decorator is obtained from `FlowHooksOf(flowName)` or a pre-built export (e.g., `ToolHook`)
- [ ] Stage name matches an actual stage in the targeted flow (e.g., `execute`, `validateInput`)
- [ ] Plugin with hooks is registered in `plugins` array of `@App` or `@FrontMcp`
- [ ] Each hook's parameter is `FlowCtxOf<'<flow-name>'>` (or a subset of it), so the compiler checks what the hook reads

### Runtime

- [ ] `@Will` hook fires before the targeted stage
- [ ] `@Did` hook fires after the targeted stage succeeds
- [ ] `@Finally` hook fires after the targeted stage on success and on failure, and reads the failure from `ctx.state.flowError`
- [ ] `@Around` hook calls `next()` and the wrapped stage executes
- [ ] A `@Stage` hook meant to stand in for the stage ends the flow with `ctx.respond()` and a valid result for the flow
- [ ] Hook `filter` correctly skips invocations for excluded tools

## Troubleshooting

| Problem                                                                       | Cause                                                                                                                                    | Solution                                                                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hook never fires                                                              | Plugin not registered in `plugins` array                                                                                                 | Add plugin class to `@App` or `@FrontMcp` `plugins` array                                                                                        |
| `InvalidHookFlowError` at startup                                             | Entry-class hook that could never run                                                                                                    | Make early-stage hooks `static`; move list-flow hooks (and a `@Job` hook for a flow other than `jobs:execute-job`) to a plugin or a provider     |
| Hook fires for wrong flow                                                     | Used wrong flow name in `FlowHooksOf`                                                                                                    | Verify flow name matches (e.g., `'tools:call-tool'` not `'tool:call'`)                                                                           |
| `@Around` skips the stage entirely                                            | `next()` not called inside the around handler                                                                                            | Always `await next()` to execute the wrapped stage                                                                                               |
| Multiple hooks execute in wrong order                                         | Priorities not set, or set as if a higher number ran first                                                                               | Lower numbers execute first: use the `HookPhase` bands, or `before` / `after` the other plugin; run with `NODE_ENV=development` to log the order |
| `HookOrderCycleError` at startup                                              | The `before` / `after` of two or more hooks on one stage contradict each other                                                           | Remove one of the constraints the error names, or let priority order one of the pairs                                                            |
| Startup warning `names '...' in before, but no hook on that stage matches it` | The target is misspelled, its plugin is not installed, or it has no hook of that type on that stage                                      | Use the plugin's `name` or the class name, with `.method` for one hook, of a hook of the same flow, stage and type                               |
| The tool still runs despite a plugin `@Stage`                                 | `@Stage` adds a step; it does not replace the stage                                                                                      | End the flow with `ctx.respond(result)`, or use `@Around` without calling `next()`                                                               |
| A span or timer opened in `@Will` stays open                                  | It is closed in `@Did`, which a failed stage skips                                                                                       | Close it in `@Finally` on the same stage                                                                                                         |
| `ctx.respond()` in a `@Finally` hook does nothing                             | `@Finally` cannot change a stage's outcome                                                                                               | Answer from `@Will`, `@Stage` or `@Around`; the flow logs a warning for each ignored `@Finally` response or throw                                |
| `TS1241: Unable to resolve signature of method decorator` on a hook           | The method's parameter asks for what the flow does not have: a missing or wrongly typed property, another flow's ctx, a second parameter | Type it `FlowCtxOf<'<flow-name>'>` and read the ctx members (`ctx.toolName`, `ctx.request`, ...); only `@Around` takes `next`                    |

## Examples

| Example                                                                                                                   | Level        | Description                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-logging-plugin`](../examples/create-plugin-hooks/basic-logging-plugin.md)                                         | Basic        | Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.                                                                                  |
| [`caching-with-around`](../examples/create-plugin-hooks/caching-with-around.md)                                           | Intermediate | Demonstrates wrapping tool execution with an `@Around` hook to implement result caching with TTL-based expiry.                                                                                                 |
| [`tool-level-hooks-and-stage-short-circuit`](../examples/create-plugin-hooks/tool-level-hooks-and-stage-short-circuit.md) | Advanced     | Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and ending the flow from a plugin `@Stage` hook with `ctx.respond()` to mock one tool. |

> See all examples in [`examples/create-plugin-hooks/`](../examples/create-plugin-hooks/)

## Reference

- [Plugin Hooks Documentation](https://frontmcp.dev/reference/sdk/plugin)
- Related skills: `create-plugin`, `official-plugins`, `create-tool`
