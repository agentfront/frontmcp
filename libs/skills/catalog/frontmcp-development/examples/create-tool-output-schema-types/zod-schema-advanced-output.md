---
name: zod-schema-advanced-output
reference: create-tool-output-schema-types
level: advanced
description: 'Demonstrates using full Zod schema objects (not raw shapes) as `outputSchema`, including `z.object()`, `z.array()`, `z.union()`, and `z.discriminatedUnion()`.'
tags: [development, output-schema, tool, output, schema, types]
features:
  - 'Using `z.object()` for structured output with nested arrays and nullable fields'
  - 'Using `z.discriminatedUnion()` to return different output shapes based on a discriminant field'
  - 'Full Zod schemas provide the same validation as raw shapes but support more complex types'
  - 'Output is validated at runtime -- mismatched return values trigger validation errors'
---

# Advanced Zod Schema Output Types

Demonstrates using full Zod schema objects (not raw shapes) as `outputSchema`, including `z.object()`, `z.array()`, `z.union()`, and `z.discriminatedUnion()`.

## Code

```typescript
// src/tools/list-products.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// z.object() -- structured object output
@Tool({
  name: 'get_order_status',
  description: 'Get the current status of an order',
  inputSchema: {
    orderId: z.string(),
  },
  outputSchema: z.object({
    orderId: z.string(),
    status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
    estimatedDelivery: z.string().nullable(),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
      }),
    ),
  }),
})
class GetOrderStatusTool extends ToolContext {
  async execute(input: { orderId: string }) {
    const order = await this.get(OrderService).getStatus(input.orderId);
    return {
      orderId: order.id,
      status: order.status,
      estimatedDelivery: order.estimatedDelivery,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    };
  }
}
```

```typescript
// src/tools/search-catalog.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// z.discriminatedUnion() -- different shapes based on a type field
const ProductResult = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('physical'),
    name: z.string(),
    weight: z.number(),
    dimensions: z.object({ width: z.number(), height: z.number(), depth: z.number() }),
  }),
  z.object({
    type: z.literal('digital'),
    name: z.string(),
    downloadUrl: z.string(),
    fileSizeMb: z.number(),
  }),
]);

@Tool({
  name: 'get_product',
  description: 'Retrieve product details by ID',
  inputSchema: {
    productId: z.string(),
  },
  outputSchema: ProductResult,
})
class GetProductTool extends ToolContext {
  async execute(input: { productId: string }) {
    const product = await this.get(CatalogService).findById(input.productId);
    return product;
  }
}
```

## What This Demonstrates

- Using `z.object()` for structured output with nested arrays and nullable fields
- Using `z.discriminatedUnion()` to return different output shapes based on a discriminant field
- Full Zod schemas provide the same validation as raw shapes but support more complex types
- Output is validated at runtime -- mismatched return values trigger validation errors

## Related

- See `create-tool-output-schema-types` for all supported output schema formats including primitives and media types
