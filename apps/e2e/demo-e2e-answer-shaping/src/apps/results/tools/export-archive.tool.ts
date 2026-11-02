import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { orders } from './orders';

@Tool({
  name: 'export-archive',
  description: 'Archived orders, from an app with its own copy of the result handles plugin',
  inputSchema: { count: z.number().int().min(1).max(5000).default(500) },
})
export default class ExportArchiveTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { orders: orders(count), total: count };
  }
}
