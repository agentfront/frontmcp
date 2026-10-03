import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/react';

const CATALOG = ['red shoes', 'blue shoes', 'green hat', 'red hat'];

@Tool({
  name: 'search_products',
  title: 'Search products',
  description: 'Search the product catalog',
  inputSchema: { query: z.string() },
  annotations: { readOnlyHint: true },
})
export class SearchProductsTool extends ToolContext {
  async execute({ query }: { query: string }) {
    return { results: CATALOG.filter((product) => product.includes(query)) };
  }
}

/** Offered to MCP clients only: never exposed through WebMCP. */
@Tool({
  name: 'admin_reset',
  description: 'Reset the store (admin only)',
  inputSchema: {},
  availableWhen: { surface: ['mcp'] },
})
export class AdminResetTool extends ToolContext {
  async execute() {
    return 'reset';
  }
}

/** Offered to in-browser agents only. */
@Tool({
  name: 'place_order',
  description: 'Place the order in the cart',
  inputSchema: {},
  annotations: { destructiveHint: true },
  availableWhen: { surface: ['webmcp'] },
})
export class PlaceOrderTool extends ToolContext {
  async execute() {
    return 'order placed';
  }
}
