import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { orders } from './orders';

@Tool({
  name: 'export-orders',
  description: 'Every order, with no output schema: a large answer folds',
  inputSchema: { count: z.number().int().min(1).max(5000).default(500) },
})
export default class ExportOrdersTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { orders: orders(count), total: count };
  }
}
