---
name: widget-with-csp-and-bridge
reference: create-tool-ui
level: intermediate
description: 'An interactive widget that fetches from an allow-listed origin via `csp.connectDomains` and invokes another tool via `window.FrontMcpBridge.callTool`.'
tags: [development, tool, ui, widget, csp, bridge, interactive, mcp-apps]
features:
  - 'Restricting widget network access with `csp.connectDomains` (CSP `connect-src`)'
  - 'Enabling tool invocation from the widget via `widgetAccessible: true`'
  - 'Calling another tool via `window.FrontMcpBridge.callTool(name, args)` instead of direct host APIs'
  - 'Using `ctx.helpers.jsonEmbed(...)` to safely pass JSON into an inline `<script>` block'
  - 'Surfacing status text during execution via `invocationStatus.invoking` / `invoked`'
---

# Interactive Widget with CSP + Bridge

An interactive widget that fetches from an allow-listed origin via `csp.connectDomains` and invokes another tool via `window.FrontMcpBridge.callTool`.

## Code

```typescript
// src/apps/main/tools/get-quote.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  symbol: z.string().describe('Ticker symbol, e.g. AAPL'),
};

export const outputSchema = {
  symbol: z.string(),
  priceUsd: z.number(),
  asOf: z.string(),
};

export type GetQuoteInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GetQuoteOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/get-quote.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type GetQuoteInput, type GetQuoteOutput } from './get-quote.schema';

@Tool({
  name: 'get_quote',
  description: 'Get the latest stock price for a ticker symbol',
  inputSchema,
  outputSchema,
})
class GetQuoteTool extends ToolContext {
  async execute(input: GetQuoteInput): Promise<GetQuoteOutput> {
    const res = await this.fetch(`https://api.market.example.com/quote/${input.symbol}`);
    const body = (await res.json()) as { price: number; ts: string };
    return { symbol: input.symbol, priceUsd: body.price, asOf: body.ts };
  }
}

export { GetQuoteTool };
```

```typescript
// src/apps/main/tools/show-quote.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  symbol: z.string().describe('Ticker symbol, e.g. AAPL'),
};

export const outputSchema = {
  symbol: z.string(),
  priceUsd: z.number(),
  asOf: z.string(),
};

export type ShowQuoteInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type ShowQuoteOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/show-quote.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type ShowQuoteInput, type ShowQuoteOutput } from './show-quote.schema';

@Tool({
  name: 'show_quote',
  description: 'Render a live quote widget for a ticker symbol',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Live stock quote with refresh',
    widgetAccessible: true, // required for window.FrontMcpBridge.callTool
    invocationStatus: {
      invoking: 'Fetching quote…',
      invoked: 'Quote loaded',
    },
    csp: {
      // Only allow fetches to our own market-data API
      connectDomains: ['https://api.market.example.com'],
    },
    template: (ctx) => {
      const { output, helpers } = ctx;
      const initial = helpers.jsonEmbed(output);
      return `
        <div style="padding:16px;font-family:system-ui">
          <h2 style="margin:0">${helpers.escapeHtml(output.symbol)}</h2>
          <p id="price" style="font-size:36px;margin:8px 0">$${output.priceUsd.toFixed(2)}</p>
          <p id="asof" style="color:#666;margin:0">As of ${helpers.escapeHtml(output.asOf)}</p>
          <button id="refresh" style="margin-top:12px;padding:8px 16px">Refresh</button>
          <script>
            (function () {
              var current = ${initial};
              var btn = document.getElementById('refresh');
              btn.addEventListener('click', async function () {
                btn.disabled = true;
                btn.textContent = 'Refreshing…';
                try {
                  var next = await window.FrontMcpBridge.callTool('get_quote', { symbol: current.symbol });
                  current = next;
                  document.getElementById('price').textContent = '$' + next.priceUsd.toFixed(2);
                  document.getElementById('asof').textContent = 'As of ' + next.asOf;
                } finally {
                  btn.disabled = false;
                  btn.textContent = 'Refresh';
                }
              });
            })();
          </script>
        </div>
      `;
    },
  },
})
class ShowQuoteTool extends ToolContext {
  async execute(input: ShowQuoteInput): Promise<ShowQuoteOutput> {
    const res = await this.fetch(`https://api.market.example.com/quote/${input.symbol}`);
    const body = (await res.json()) as { price: number; ts: string };
    return { symbol: input.symbol, priceUsd: body.price, asOf: body.ts };
  }
}

export { ShowQuoteTool };
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { GetQuoteTool } from './tools/get-quote.tool';
import { ShowQuoteTool } from './tools/show-quote.tool';

@App({
  name: 'main',
  tools: [GetQuoteTool, ShowQuoteTool],
})
class MainApp {}

export { MainApp };
```

## What This Demonstrates

- Restricting widget network access with `csp.connectDomains` (CSP `connect-src`)
- Enabling tool invocation from the widget via `widgetAccessible: true`
- Calling another tool via `window.FrontMcpBridge.callTool(name, args)` instead of direct host APIs
- Using `ctx.helpers.jsonEmbed(...)` to safely pass JSON into an inline `<script>` block
- Surfacing status text during execution via `invocationStatus.invoking` / `invoked`

## Related

- See `create-tool-ui` for all `csp` and bridge details (including `hasCapability`, `getStructuredContent`, host-specific routing)
- See `create-tool` for the underlying `@Tool` decorator
