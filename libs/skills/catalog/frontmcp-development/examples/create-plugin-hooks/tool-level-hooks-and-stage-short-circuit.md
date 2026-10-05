---
name: tool-level-hooks-and-stage-short-circuit
reference: create-plugin-hooks
level: advanced
description: 'Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and ending the flow from a plugin `@Stage` hook with `ctx.respond()` to mock one tool.'
tags: [development, plugin-hooks, plugin, hooks, tool, level]
features:
  - "Placing `@Will('execute')` and `@Did('execute')` directly on a `@Tool` class so hooks fire only for that tool"
  - 'Using `this.fail()` in a `@Will` hook to abort execution when preconditions are not met'
  - 'Using `this.mark()` to record lifecycle checkpoints during hook execution'
  - "A plugin `@Stage('execute')` runs alongside the tool's own `execute` step and its return value is ignored"
  - 'Calling `ctx.respond()` from a `@Stage` hook with a `filter` predicate to end the flow for one tool name'
  - 'The difference between tool-level hooks (scoped to one tool) and plugin-level hooks (fire for all tools)'
---

# Tool-Level Hooks and Ending the Flow from a Stage Hook

Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and ending the flow from a plugin `@Stage` hook with `ctx.respond()` to mock one tool.

## Code

```typescript
// src/tools/process-order.tool.ts
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

  async execute(input: ProcessOrderInput) {
    const payment = this.get(PAYMENT_TOKEN);
    const receipt = await payment.charge(input.orderId, input.amount);
    return { status: 'completed', receipt: receipt.id };
  }

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

```typescript
// src/plugins/mock.plugin.ts
import { FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

const { Stage } = ToolHook;

@Plugin({ name: 'mock-plugin' })
export class MockPlugin {
  // Joins the `execute` stage and runs before the tool's own step (same priority).
  @Stage('execute', {
    filter: (ctx) => ctx.state.required.input.name === 'fetch_weather',
  })
  mockWeather(ctx: FlowCtxOf<'tools:call-tool'>) {
    // Ends the flow with this result, so `fetch_weather`'s execute() does not run.
    ctx.respond({ content: [{ type: 'text', text: '72F and sunny' }] });
  }
}
```

## What This Demonstrates

- Placing `@Will('execute')` and `@Did('execute')` directly on a `@Tool` class so hooks fire only for that tool
- Using `this.fail()` in a `@Will` hook to abort execution when preconditions are not met
- Using `this.mark()` to record lifecycle checkpoints during hook execution
- A plugin `@Stage('execute')` runs alongside the tool's own `execute` step and its return value is ignored
- Calling `ctx.respond()` from a `@Stage` hook with a `filter` predicate to end the flow for one tool name
- The difference between tool-level hooks (scoped to one tool) and plugin-level hooks (fire for all tools)

## Related

- See `create-plugin-hooks` for the full list of hookable stages in the `call-tool` flow, and for an `@Around` hook that replaces the stage's result instead
- See `decorators-guide` for the complete decorator hierarchy including `@Tool` and `@Plugin`
