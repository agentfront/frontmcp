---
name: create-plugin-hooks
description: Intercept and extend FrontMCP flows using before, after, around, and stage hook decorators
---

# Creating Plugins with Flow Lifecycle Hooks

Plugins intercept and extend FrontMCP flows using lifecycle hook decorators. Every flow (tool calls, resource reads, prompt gets, etc.) is composed of **stages**, and hooks let you run logic before, after, around, or as part of any stage.

## When to Use This Skill

### Must Use

- Adding before/after logic to tool execution (logging, metrics, input enrichment)
- Implementing authorization checks that intercept flows before they reach the tool
- Wrapping stage execution with caching, retry, or timing logic via `@Around`

### Recommended

- Adding a step to a built-in stage, or ending the flow early from it, with `@Stage`
- Adding hooks directly on a `@Tool` class for tool-specific pre/post processing
- Filtering hook execution by tool name or context properties using `filter` predicates

### Skip When

- You need providers, context extensions, or contributed tools (see `create-plugin`)
- You want to use an existing official plugin that already provides hooks (see `official-plugins`)
- You are building a simple tool with no cross-cutting concerns (see `create-tool`)

> **Decision:** Use this skill when you need to intercept or wrap flow stages with `@Will`, `@Did`, `@Around`, or `@Stage` decorators.

## Hook Decorator Types

FrontMCP provides four hook decorators obtained via `FlowHooksOf(flowName)`:

| Decorator | Timing                                           | Use Case                                       |
| --------- | ------------------------------------------------ | ---------------------------------------------- |
| `@Will`   | **Before** a stage runs                          | Validate input, inject headers, check auth     |
| `@Did`    | **After** a stage completes                      | Log results, emit metrics, transform output    |
| `@Stage`  | **Joins** a stage, alongside the flow's own step | Extra work in the stage, ending the flow early |
| `@Around` | **Wraps** a stage (before + after)               | Caching, timing, retry, skipping the stage     |

### FlowHooksOf API

```typescript
import { FlowHooksOf } from '@frontmcp/sdk';

const { Stage, Will, Did, Around } = FlowHooksOf('tools:call-tool');
```

`FlowHooksOf(flowName)` returns an object with all four decorator factories bound to the specified flow.

### What `@Stage` Does

A `@Stage('execute')` hook does not replace the flow's own `execute` step: it adds a step to that stage, and the flow's own step still runs. The steps of a stage run in `priority` order (lower first). At equal priority, a plugin's or provider's step runs before the flow's own step, and a step declared on a `@Tool` class runs after it. The value a `@Stage` method returns is ignored.

To keep the flow's own step from running:

- Call `ctx.respond(result)` from the `@Stage` (or a `@Will`) hook. The flow ends with that result: it skips the rest of the stage and the main stages after it, while the stage's `@Did` hooks and the cleanup stages (in `tools:call-tool`: `releaseSemaphore`, `releaseQuota`, `applyUI`, `finalize`) still run. In `tools:call-tool`, `result` is a complete MCP `CallToolResult`; it does not go through the tool's output schema.
- Or use an `@Around` hook that does not call `next()`. The stage is skipped and the flow goes on; in `tools:call-tool`, set `ctx.state.required.toolContext.output`, and the result is validated and formatted like the tool's own.

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
| `channels:send-notification`        | Channel notification send | `ChannelSendHook`           |
| `channels:list`                     | Channel listing           | `ChannelListHook`           |

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

In addition to flow-based hooks, the framework exposes a single `scope.onServerStarted(callback)` API for post-startup work. Callbacks register against the active `ScopeEntry` and run after `server.start()` completes.

### `onServerStarted()`

Use for warming caches, starting background indexing, or logging readiness once the server is live.

**Signature:** `scope.onServerStarted(callback: () => void | Promise<void>): void`

- Callbacks are stored on the active scope and invoked when `emitServerStarted()` runs after startup.
- Supports both sync and async callbacks; multiple callbacks execute in registration order with `await`.

The cleanest place to call it from a plugin is a factory provider whose `useFactory` receives the active scope, or from a class provider's lifecycle. A common pattern is to register the callback from a hook method using the plugin's injected scope (the plugin instance has a `get(token)` accessor available after construction):

```typescript
import { Plugin, ToolHook } from '@frontmcp/sdk';

const { Will } = ToolHook;

@Plugin({
  name: 'cache-warmer',
  description: 'Warms caches when the server starts',
  providers: [CacheService],
})
export class CacheWarmerPlugin {
  private registered = false;

  // Lazy-register the lifecycle callback the first time any tool is called.
  // For pure post-startup work, prefer registering from a Provider with access
  // to the active scope, or expose the callback registration via a custom Provider.
  @Will('parseInput', { priority: 1000 })
  registerOnce() {
    if (this.registered) return;
    this.registered = true;
    const cache = this.get(CacheService);
    // `this.get` is wired by the plugin registry post-construction; resolve scope similarly
    // via a Provider that exposes onServerStarted, e.g. a `ScopeAccessor` wrapper.
    cache.warmAllInBackground();
  }
}
```

> **Pattern note:** `ScopeEntry` is not directly DI-injectable into a plugin constructor (it is a scope-level entry, not a token-registered provider). For lifecycle work, prefer wiring `onServerStarted(...)` through a Provider that receives the scope via `providers.getActiveScope()`, or use Provider/Adapter `onInit` hooks where appropriate. See `apps/demo` for working patterns.

## Pre-Built Hook Type Exports

For convenience, FrontMCP exports typed aliases so you do not need to call `FlowHooksOf` directly:

```typescript
import {
  AgentCallHook, // FlowHooksOf('agents:call-agent')
  ChannelListHook, // FlowHooksOf('channels:list')
  ChannelSendHook, // FlowHooksOf('channels:send-notification')
  CompletionHook, // FlowHooksOf('completion:complete')
  HttpHook, // FlowHooksOf('http:request')
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
const { Will, Did, Around, Stage } = ToolHook;
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

| Member            | Description                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`           | The flow's state, typed per flow: read `ctx.state.tool` (or `ctx.state.required.tool`, which throws when unset), write with `ctx.state.set(key, value)` |
| `rawInput`        | The input the flow was started with; for `tools:call-tool`, the MCP `request` and its `ctx`                                                             |
| `logger`          | The flow's logger (the tool, resource and prompt flows define one; every flow has `scopeLogger`)                                                        |
| `get(token)`      | Resolves a provider registered on the server, or a context-scoped provider of the current call                                                          |
| `respond(output)` | Ends the flow with this output                                                                                                                          |
| `fail(error)`     | Ends the flow with this error (an `Error`, such as an MCP error class)                                                                                  |

The flow has no `toolName`, `elapsed` or `tryGet`, and its `input` is protected. In `tools:call-tool`, read the tool name and arguments from `ctx.state.required.input` (`name`, `arguments`), the tool entry from `ctx.state.tool`, and the tool instance from `ctx.state.toolContext` (set from `createToolCallContext` on). The state accepts only the keys the flow declares: `ctx.state.set('startedAt', Date.now())` does not compile.

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
      ctx.logger.info(`Tool "${ctx.state.required.input.name}" took ${Date.now() - startedAt}ms`);
    }
  }
}
```

## HookOptions

All four decorators accept an optional options object:

```typescript
@Will('execute', {
  priority: 10, // Lower runs first (default: 0)
  filter: (ctx) => ctx.state.required.input.name !== 'health_check', // Predicate to skip
  appliesTo: 'own-app', // Reach of an app plugin's hook (default: 'own-app')
})
```

- **priority** (`number`) - Execution order when multiple hooks target the same stage. Lower values run first, for `@Will`, `@Did`, `@Around` and `@Stage` alike. Default: `0`.
- **filter** (`(ctx) => boolean`) - A predicate that receives the flow context. Return `false` to skip this hook for the current invocation.
- **appliesTo** (`'own-app' | 'uncovered-apps'`) - A hook of a plugin installed on an app runs, in `tools/call`, `resources/read`, `prompts/get` and `completion/complete`, only for that app's entries (`'own-app'`). With `'uncovered-apps'` it also runs for the entries of any app that has no instance of the same hook (same class and method) of its own or from a server-level plugin. Use it for gates an entry's metadata asks for (approval, feature flags), so the entry is not left ungated when the plugin sits on another app. Server-level plugins' hooks, and list-flow hooks, already run for every app.

## Examples

### Logging Plugin

```typescript
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'logging-plugin' })
export class LoggingPlugin {
  @Will('execute', { priority: -100 })
  logBefore(ctx: FlowCtxOf<'tools:call-tool'>) {
    const { name, arguments: toolArguments } = ctx.state.required.input;
    ctx.logger.info(`Tool "${name}" called`, toolArguments);
  }

  @Did('execute')
  logAfter(ctx: FlowCtxOf<'tools:call-tool'>) {
    ctx.logger.info(`Tool "${ctx.state.required.input.name}" completed`);
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
    const { name, arguments: toolArguments } = ctx.state.required.input;
    const key = `${name}:${JSON.stringify(toolArguments)}`;
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
    filter: (ctx) => ctx.state.required.input.name === 'fetch_weather',
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

Plugins are initialized in array order. Hook priority determines execution order within the same stage.

Hooks declared on an app's providers, on its plugins (including plugins nested inside them), and on those plugins' providers run only for that app's tools, resources and prompts (`tools:call-tool`, `resources:read-resource`, `prompts:get-prompt`, `completion:complete`), including the ones its adapters and plugins provide, such as the tools an OpenAPI adapter generates. Plugins and providers registered on the server (`@FrontMcp({ plugins, providers })`) apply to every app. Resources and prompts the server serves outside every app, such as the SEP-2640 `skill://` resources, run every app's hooks.

A hook declared on a `CONTEXT`-scoped provider (`@Provider({ scope: ProviderScope.CONTEXT })`, a class provider) runs on the instance built for the request or session -- the same instance the request's tools get from `this.get()`. Up to 1.8.7, hooks on server-level and `CONTEXT`-scoped providers were never registered.

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
- `@Will('validateInput')` runs before input validation — useful for input enrichment
- `@Did('validateOutput')` runs after output validation — useful for output transformation
- The hook has full access to `this` (the tool context) including `this.input`, `this.get()`, `this.fail()`

### Available Stages for Tool Hooks

```
parseInput → ensureRemoteCapabilities → findTool → checkToolAuthorization → checkEntryAuthorities
  → createTaskIfRequested → createToolCallContext → checkToolCredentials → acquireQuota → acquireSemaphore
  → validateInput → execute → validateOutput → releaseSemaphore → releaseQuota → applyUI → finalize
```

A tool-class hook runs on the tool instance, which `createToolCallContext` builds. So it can hook `Did`/`Stage` on `createToolCallContext` and any hook on a later stage. A hook on an earlier stage, `Will`/`Around` on `createToolCallContext`, or a list-flow hook (`ListToolsHook`; listing builds no instance) fails startup with `InvalidHookFlowError` -- put those on a plugin or a provider. The same holds for `@Resource` (`createResourceContext`), `@Prompt` (`createPromptContext`) and `@Agent` (`createAgentContext`) classes. `@Job` classes cannot declare hooks at all (jobs do not run through a hookable flow); hook `tools:call-tool` for the `execute_job` tool instead. Up to 1.8.7 these hooks were accepted and silently never ran.

## Common Patterns

| Pattern               | Correct                                                               | Incorrect                                                              | Why                                                                                |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hook decorator source | `const { Will, Did } = ToolHook;` or `FlowHooksOf('tools:call-tool')` | Importing `Will` directly from `@frontmcp/sdk`                         | Decorators must be bound to a specific flow via `FlowHooksOf` or pre-built exports |
| Hook priority         | `@Will('execute', { priority: -100 })` for early hooks                | Relying on array order without priority                                | Multiple hooks on the same stage need explicit priority; lower runs first          |
| Around next()         | `await next();`                                                       | Forgetting to call `next()` in `@Around`                               | Omitting `next()` skips the wrapped stage; its `@Did` hooks still run              |
| Around error recovery | `catch { ctx.state.required.toolContext.output = fallback; }`         | Catching a rejected `next()` without setting the output                | Returning normally handles the failure: the stage counts as successful             |
| Filter predicate      | `filter: (ctx) => ctx.state.required.input.name !== 'health_check'`   | Checking tool name inside the hook body and returning early            | A filtered-out hook is skipped cleanly; for `@Around`, the stage still runs        |
| Tool-level hooks      | `@Will('execute')` on a `@Tool` class (scoped to that tool)           | `@Will('execute')` on a `@Plugin` class expecting tool-scoped behavior | Plugin hooks fire for every tool of the app; tool-level hooks only for that tool   |

## Verification Checklist

### Configuration

- [ ] Hook decorator is obtained from `FlowHooksOf(flowName)` or a pre-built export (e.g., `ToolHook`)
- [ ] Stage name matches an actual stage in the targeted flow (e.g., `execute`, `validateInput`)
- [ ] Plugin with hooks is registered in `plugins` array of `@App` or `@FrontMcp`

### Runtime

- [ ] `@Will` hook fires before the targeted stage
- [ ] `@Did` hook fires after the targeted stage completes
- [ ] `@Around` hook calls `next()` and the wrapped stage executes
- [ ] A `@Stage` hook meant to stand in for the stage ends the flow with `ctx.respond()` and a valid result for the flow
- [ ] Hook `filter` correctly skips invocations for excluded tools

## Troubleshooting

| Problem                                       | Cause                                               | Solution                                                                           |
| --------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hook never fires                              | Plugin not registered in `plugins` array            | Add plugin class to `@App` or `@FrontMcp` `plugins` array                          |
| `InvalidHookFlowError` at startup             | Entry-class hook that could never run               | Move early-stage, list-flow and `@Job` hooks to a plugin or a provider             |
| Hook fires for wrong flow                     | Used wrong flow name in `FlowHooksOf`               | Verify flow name matches (e.g., `'tools:call-tool'` not `'tool:call'`)             |
| `@Around` skips the stage entirely            | `next()` not called inside the around handler       | Always `await next()` to execute the wrapped stage                                 |
| Multiple hooks execute in wrong order         | Priorities not set or conflicting                   | Set explicit `priority` values; lower numbers execute first                        |
| The tool still runs despite a plugin `@Stage` | `@Stage` adds a step; it does not replace the stage | End the flow with `ctx.respond(result)`, or use `@Around` without calling `next()` |

## Examples

| Example                                                                                                                   | Level        | Description                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-logging-plugin`](../examples/create-plugin-hooks/basic-logging-plugin.md)                                         | Basic        | Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.                                                                                  |
| [`caching-with-around`](../examples/create-plugin-hooks/caching-with-around.md)                                           | Intermediate | Demonstrates wrapping tool execution with an `@Around` hook to implement result caching with TTL-based expiry.                                                                                                 |
| [`tool-level-hooks-and-stage-short-circuit`](../examples/create-plugin-hooks/tool-level-hooks-and-stage-short-circuit.md) | Advanced     | Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and ending the flow from a plugin `@Stage` hook with `ctx.respond()` to mock one tool. |

> See all examples in [`examples/create-plugin-hooks/`](../examples/create-plugin-hooks/)

## Reference

- [Plugin Hooks Documentation](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- Related skills: `create-plugin`, `official-plugins`, `create-tool`
