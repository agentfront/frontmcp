import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { orders, orderSchema } from './orders';

/** Its output schema has no room for the folded form, so its large answers go to the budget instead. */
@Tool({
  name: 'strict-orders',
  description: 'Every order, with an output schema the folded form does not match',
  inputSchema: { count: z.number().int().min(1).max(5000).default(500) },
  outputSchema: { orders: z.array(orderSchema), total: z.number() },
})
export default class StrictOrdersTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { orders: orders(count), total: count };
  }
}
