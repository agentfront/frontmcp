---
name: create-plugin-hooks
description: Create plugins with flow lifecycle hooks using @Will, @Did, @Stage, and @Around decorators. Use when intercepting tool calls, adding logging, modifying request/response, or implementing cross-cutting middleware.
tags: [plugin, hooks, will, did, stage, around, flow, middleware]
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/plugins/creating-plugins
---

# Creating Plugins with Flow Lifecycle Hooks

Plugins intercept and extend FrontMCP flows using lifecycle hook decorators. Every flow (tool calls, resource reads, prompt gets, etc.) is composed of **stages**, and hooks let you run logic before, after, around, or instead of any stage.

## When to Use This Skill

### Must Use

- Adding before/after logic to tool execution (logging, metrics, input enrichment)
- Implementing authorization checks that intercept flows before they reach the tool
- Wrapping stage execution with caching, retry, or timing logic via `@Around`

### Recommended

- Replacing a built-in stage entirely with custom logic using `@Stage`
- Adding hooks directly on a `@Tool` class for tool-specific pre/post processing
- Filtering hook execution by tool name or context properties using `filter` predicates

### Skip When

- You need providers, context extensions, or contributed tools (see `create-plugin`)
- You want to use an existing official plugin that already provides hooks (see `official-plugins`)
- You are building a simple tool with no cross-cutting concerns (see `create-tool`)

> **Decision:** Use this skill when you need to intercept or wrap flow stages with `@Will`, `@Did`, `@Around`, or `@Stage` decorators.

## Hook Decorator Types

FrontMCP provides four hook decorators obtained via `FlowHooksOf(flowName)`:

| Decorator | Timing                             | Use Case                                    |
| --------- | ---------------------------------- | ------------------------------------------- |
| `@Will`   | **Before** a stage runs            | Validate input, inject headers, check auth  |
| `@Did`    | **After** a stage completes        | Log results, emit metrics, transform output |
| `@Stage`  | **Replaces** a stage entirely      | Custom execution, mock responses            |
| `@Around` | **Wraps** a stage (before + after) | Caching, timing, retry logic                |

### FlowHooksOf API

```typescript
import { FlowHooksOf } from '@frontmcp/sdk';

const { Stage, Will, Did, Around } = FlowHooksOf('tools:call-tool');
```

`FlowHooksOf(flowName)` returns an object with all four decorator factories bound to the specified flow.

## Available Flow Names

| Flow Name                  | Description              |
| -------------------------- | ------------------------ |
| `tools:call-tool`          | Tool execution           |
| `tools:list-tools`         | Tool listing / discovery |
| `resources:read-resource`  | Resource reading         |
| `resources:list-resources` | Resource listing         |
| `prompts:get-prompt`       | Prompt retrieval         |
| `prompts:list-prompts`     | Prompt listing           |
| `http:request`             | HTTP request handling    |
| `agents:call-agent`        | Agent invocation         |

## Pre-Built Hook Type Exports

For convenience, FrontMCP exports typed aliases so you do not need to call `FlowHooksOf` directly:

```typescript
import {
  ToolHook, // FlowHooksOf('tools:call-tool')
  ListToolsHook, // FlowHooksOf('tools:list-tools')
  ResourceHook, // FlowHooksOf('resources:read-resource')
  ListResourcesHook, // FlowHooksOf('resources:list-resources')
  AgentCallHook, // FlowHooksOf('agents:call-agent')
  HttpHook, // FlowHooksOf('http:request')
} from '@frontmcp/sdk';
```

Usage:

```typescript
const { Will, Did, Around, Stage } = ToolHook;
```

## call-tool Flow Stages

The `tools:call-tool` flow proceeds through these stages in order:

1. **parseInput** - Parse raw input from the MCP request
2. **findTool** - Look up the tool in the registry
3. **checkToolAuthorization** - Verify the caller is authorized
4. **createToolCallContext** - Build the ToolContext instance
5. **validateInput** - Validate input against the Zod schema
6. **execute** - Run the tool's `execute()` method
7. **validateOutput** - Validate output against the output schema
8. **finalize** - Format and return the MCP response

## HookOptions

Both `@Will` and `@Did` (and `@Around`) accept an optional options object:

```typescript
@Will('execute', {
  priority: 10,                          // Higher runs first (default: 0)
  filter: (ctx) => ctx.toolName !== 'health_check',  // Predicate to skip
})
```

- **priority** (`number`) - Execution order when multiple hooks target the same stage. Higher values run first. Default: `0`.
- **filter** (`(ctx) => boolean`) - A predicate that receives the flow context. Return `false` to skip this hook for the current invocation.

## Examples

### Logging Plugin

```typescript
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Will, Did } = ToolHook;

@Plugin({ name: 'logging-plugin' })
export class LoggingPlugin {
  @Will('execute', { priority: 100 })
  logBefore(ctx) {
    console.log(`[LOG] Tool "${ctx.toolName}" called with`, ctx.input);
  }

  @Did('execute')
  logAfter(ctx) {
    console.log(`[LOG] Tool "${ctx.toolName}" completed in ${ctx.elapsed}ms`);
  }
}
```

### Authorization Check Plugin

```typescript
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Will } = ToolHook;

@Plugin({ name: 'auth-check-plugin' })
export class AuthCheckPlugin {
  @Will('checkToolAuthorization', { priority: 50 })
  enforceRole(ctx) {
    const user = ctx.tryGet(UserToken);
    if (!user || !user.roles.includes('admin')) {
      ctx.fail('Unauthorized: admin role required');
    }
  }
}
```

### Caching Plugin with @Around

```typescript
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Around } = ToolHook;

@Plugin({ name: 'cache-plugin' })
export class CachePlugin {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  @Around('execute', { priority: 90 })
  async cacheResults(ctx, next) {
    const key = `${ctx.toolName}:${JSON.stringify(ctx.input)}`;
    const cached = this.cache.get(key);

    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const result = await next();

    this.cache.set(key, {
      data: result,
      expiry: Date.now() + 60_000,
    });

    return result;
  }
}
```

### Stage Replacement

```typescript
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Stage } = ToolHook;

@Plugin({ name: 'mock-plugin' })
export class MockPlugin {
  @Stage('execute', {
    filter: (ctx) => ctx.toolName === 'fetch_weather',
  })
  mockWeather(ctx) {
    return { content: [{ type: 'text', text: '72F and sunny' }] };
  }
}
```

## Registering Plugins

Register plugins in your `@App` decorator:

```typescript
import { App } from '@frontmcp/sdk';
import { LoggingPlugin } from './plugins/logging.plugin';
import { CachePlugin } from './plugins/cache.plugin';

@App({
  name: 'my-app',
  plugins: [LoggingPlugin, CachePlugin],
})
export class MyApp {}
```

Plugins are initialized in array order. Hook priority determines execution order within the same stage.

## Using Hooks Inside a @Tool Class

You can add hook methods directly on a `@Tool` class to intercept its own execution flow. The hooks apply only when **this tool** is called:

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const { Will, Did } = ToolHook;

@Tool({
  name: 'process_order',
  description: 'Process a customer order',
  inputSchema: {
    orderId: z.string(),
    amount: z.number(),
  },
  outputSchema: { status: z.string(), receipt: z.string() },
})
class ProcessOrderTool extends ToolContext {
  // Runs BEFORE execute — validate, enrich input, check preconditions
  @Will('execute', { priority: 10 })
  async beforeExecute() {
    const db = this.get(DB_TOKEN);
    const order = await db.findOrder(this.input.orderId);
    if (!order) {
      this.fail(new Error(`Order ${this.input.orderId} not found`));
    }
    if (order.status === 'completed') {
      this.fail(new Error('Order already processed'));
    }
    this.mark('validated');
  }

  // Main execution
  async execute(input: { orderId: string; amount: number }) {
    const payment = this.get(PAYMENT_TOKEN);
    const receipt = await payment.charge(input.orderId, input.amount);
    return { status: 'completed', receipt: receipt.id };
  }

  // Runs AFTER execute — log, notify, cleanup
  @Did('execute')
  async afterExecute() {
    const analytics = this.tryGet(ANALYTICS_TOKEN);
    if (analytics) {
      await analytics.track('order_processed', {
        orderId: this.input.orderId,
        amount: this.input.amount,
      });
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
parseInput → findTool → checkToolAuthorization → createToolCallContext
  → validateInput → execute → validateOutput → finalize
```

Any stage can have `@Will`, `@Did`, `@Stage`, or `@Around` hooks.

## Common Patterns

| Pattern               | Correct                                                               | Incorrect                                                              | Why                                                                                |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hook decorator source | `const { Will, Did } = ToolHook;` or `FlowHooksOf('tools:call-tool')` | Importing `Will` directly from `@frontmcp/sdk`                         | Decorators must be bound to a specific flow via `FlowHooksOf` or pre-built exports |
| Hook priority         | `@Will('execute', { priority: 100 })` for early hooks                 | Relying on array order without priority                                | Multiple hooks on the same stage need explicit priority; higher runs first         |
| Around next()         | `const result = await next(); return result;`                         | Forgetting to call `next()` in `@Around`                               | Omitting `next()` silently skips the wrapped stage and all downstream hooks        |
| Filter predicate      | `filter: (ctx) => ctx.toolName !== 'health_check'`                    | Checking tool name inside the hook body and returning early            | Filters skip the hook cleanly; returning early may leave state inconsistent        |
| Tool-level hooks      | `@Will('execute')` on a `@Tool` class (scoped to that tool)           | `@Will('execute')` on a `@Plugin` class expecting tool-scoped behavior | Plugin hooks fire for all tools; tool-level hooks fire only for that tool          |

## Verification Checklist

### Configuration

- [ ] Hook decorator is obtained from `FlowHooksOf(flowName)` or a pre-built export (e.g., `ToolHook`)
- [ ] Stage name matches an actual stage in the targeted flow (e.g., `execute`, `validateInput`)
- [ ] Plugin with hooks is registered in `plugins` array of `@App` or `@FrontMcp`

### Runtime

- [ ] `@Will` hook fires before the targeted stage
- [ ] `@Did` hook fires after the targeted stage completes
- [ ] `@Around` hook calls `next()` and the wrapped stage executes
- [ ] `@Stage` replacement returns a valid response for the flow
- [ ] Hook `filter` correctly skips invocations for excluded tools

## Troubleshooting

| Problem                                       | Cause                                            | Solution                                                                          |
| --------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Hook never fires                              | Plugin not registered in `plugins` array         | Add plugin class to `@App` or `@FrontMcp` `plugins` array                         |
| Hook fires for wrong flow                     | Used wrong flow name in `FlowHooksOf`            | Verify flow name matches (e.g., `'tools:call-tool'` not `'tool:call'`)            |
| `@Around` skips the stage entirely            | `next()` not called inside the around handler    | Always `await next()` to execute the wrapped stage                                |
| Multiple hooks execute in wrong order         | Priorities not set or conflicting                | Set explicit `priority` values; higher numbers execute first                      |
| `@Stage` replacement causes downstream errors | Return value shape does not match stage contract | Ensure the return matches what the next stage expects (e.g., MCP response format) |

## Reference

- [Plugin Hooks Documentation](https://docs.agentfront.dev/frontmcp/plugins/creating-plugins)
- Related skills: `create-plugin`, `official-plugins`, `create-tool`
