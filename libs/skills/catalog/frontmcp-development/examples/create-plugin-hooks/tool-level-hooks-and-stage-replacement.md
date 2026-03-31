---
name: tool-level-hooks-and-stage-replacement
reference: create-plugin-hooks
level: advanced
description: 'Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and using `@Stage` in a plugin to replace a flow stage entirely with a filtered mock.'
tags: [development, plugin-hooks, plugin, hooks, tool, level]
features:
  - "Placing `@Will('execute')` and `@Did('execute')` directly on a `@Tool` class so hooks fire only for that tool"
  - 'Using `this.fail()` in a `@Will` hook to abort execution when preconditions are not met'
  - 'Using `this.mark()` to record lifecycle checkpoints during hook execution'
  - 'Using `@Stage` with a `filter` predicate to replace the `execute` stage only for a specific tool name'
  - 'The difference between tool-level hooks (scoped to one tool) and plugin-level hooks (fire for all tools)'
---

# Tool-Level Hooks and Stage Replacement

Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and using `@Stage` in a plugin to replace a flow stage entirely with a filtered mock.

## Code

```typescript
// src/tools/process-order.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';
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

  async execute(input: { orderId: string; amount: number }) {
    const payment = this.get(PAYMENT_TOKEN);
    const receipt = await payment.charge(input.orderId, input.amount);
    return { status: 'completed', receipt: receipt.id };
  }

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

```typescript
// src/plugins/mock.plugin.ts
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

## What This Demonstrates

- Placing `@Will('execute')` and `@Did('execute')` directly on a `@Tool` class so hooks fire only for that tool
- Using `this.fail()` in a `@Will` hook to abort execution when preconditions are not met
- Using `this.mark()` to record lifecycle checkpoints during hook execution
- Using `@Stage` with a `filter` predicate to replace the `execute` stage only for a specific tool name
- The difference between tool-level hooks (scoped to one tool) and plugin-level hooks (fire for all tools)

## Related

- See `create-plugin-hooks` for the full list of hookable stages in the `call-tool` flow
- See `decorators-guide` for the complete decorator hierarchy including `@Tool` and `@Plugin`
