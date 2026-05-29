---
name: 03-tool-with-zod-shape-output
level: basic
description: Tool returning structured JSON declared via a Zod raw shape outputSchema — the recommended pattern for any complex output.
tags: [output-schema, zod-shape, structured-output]
features:
  - 'Declaring `outputSchema` as a Zod raw shape `{ field: z.string(), … }`'
  - 'Constraining values with `.int().min(0)` so invalid output is rejected at the boundary'
  - "Letting unrelated fields returned by the implementation (e.g. an upstream API's extras) be stripped silently"
  - "Deriving `OrderSummaryOutput` once so the type and runtime contract can't drift"
---

# Tool With Zod Shape Output

Tool returning structured JSON declared via a Zod raw shape outputSchema — the recommended pattern for any complex output.

For structured JSON, declare `outputSchema` as a Zod raw shape — the same form as `inputSchema`. The shape is the runtime contract AND the source of the TypeScript output type.

## Code

```typescript
// src/apps/main/tools/order-summary.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  orderId: z.string().uuid().describe('Order UUID'),
};

export const outputSchema = {
  orderId: z.string(),
  customer: z.string(),
  totalUsd: z.number(),
  itemCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
};

export type OrderSummaryInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type OrderSummaryOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/order-summary.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { ORDERS_REPO } from '../tokens';
import { inputSchema, outputSchema, type OrderSummaryInput, type OrderSummaryOutput } from './order-summary.schema';

@Tool({
  name: 'order_summary',
  description: 'Summary for an order — totals, item counts, and status.',
  inputSchema,
  outputSchema,
})
export class OrderSummaryTool extends ToolContext {
  async execute(input: OrderSummaryInput): Promise<OrderSummaryOutput> {
    const repo = this.get(ORDERS_REPO);
    const order = await repo.findById(input.orderId);
    // `order` may carry { …, internalNotes, paymentProviderRef, debug }
    // — none of those are in outputSchema, so they're stripped before returning.
    return {
      orderId: order.id,
      customer: order.customerName,
      totalUsd: order.totalCents / 100,
      itemCount: order.items.length,
      pendingCount: order.items.filter((i) => i.status === 'pending').length,
      status: order.status,
    };
  }
}
```

## What This Demonstrates

- Declaring `outputSchema` as a Zod raw shape `{ field: z.string(), … }`
- Constraining values with `.int().min(0)` so invalid output is rejected at the boundary
- Letting unrelated fields returned by the implementation (e.g. an upstream API's extras) be stripped silently
- Deriving `OrderSummaryOutput` once so the type and runtime contract can't drift
