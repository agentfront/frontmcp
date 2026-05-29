---
name: 24-tool-with-ui-csp-and-bridge
level: advanced
description: 'Interactive tool widget that fetches from an allow-listed CSP origin and invokes another tool via `window.FrontMcpBridge.callTool` — the full pattern for live-data widgets that need cross-tool composition.'
tags: [ui, csp, widgetAccessible, FrontMcpBridge, interactive-widget]
features:
  - "Restricting the widget's outbound `fetch` via `ui.csp.connectDomains` (emitted on the resource per #455)"
  - 'Opting the widget into cross-tool calls with `widgetAccessible: true` and using `window.FrontMcpBridge.callTool(name, args)` instead of host-specific APIs'
  - "Embedding initial data into the widget's inline `<script>` safely via `ctx.helpers.jsonEmbed(...)` (escapes `</script>`)"
  - 'Surfacing in-flight status via `invocationStatus.invoking` / `invoked` so the host UI shows feedback'
---

# Tool With Ui Csp And Bridge

Interactive tool widget that fetches from an allow-listed CSP origin and invokes another tool via `window.FrontMcpBridge.callTool` — the full pattern for live-data widgets that need cross-tool composition.

The advanced widget pattern. The tool's response renders a stock-quote card with a "Refresh" button that calls another tool through the bridge. CSP locks down outbound fetches; the bridge routes cross-tool calls to the right host adapter (OpenAI / Claude / direct) automatically.

## Code

```typescript
// src/apps/main/tools/get-quote/get-quote.tool.ts
import { PublicMcpError, Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = { symbol: z.string().regex(/^[A-Z]{1,5}$/) };
const outputSchema = { symbol: z.string(), priceUsd: z.number(), asOf: z.string() };

@Tool({
  name: 'get_quote',
  description: 'Get the latest stock price for a ticker symbol',
  inputSchema,
  outputSchema,
})
export class GetQuoteTool extends ToolContext {
  async execute(input: { symbol: string }) {
    const res = await this.fetch(`https://api.market.example/quote/${input.symbol}`);
    if (!res.ok) {
      this.fail(new PublicMcpError(`Quote upstream returned ${res.status} ${res.statusText}`));
    }
    const body = (await res.json()) as { price: number; ts: string };
    return { symbol: input.symbol, priceUsd: body.price, asOf: body.ts };
  }
}
```

```typescript
// src/apps/main/tools/show-quote/show-quote.tool.ts
import { PublicMcpError, Tool, ToolContext, z, type TemplateContext } from '@frontmcp/sdk';

const inputSchema = { symbol: z.string().regex(/^[A-Z]{1,5}$/) };
const outputSchema = { symbol: z.string(), priceUsd: z.number(), asOf: z.string() };
type In = { symbol: string };
type Out = { symbol: string; priceUsd: number; asOf: string };

@Tool({
  name: 'show_quote',
  description: 'Render a live quote widget for a ticker symbol',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Live stock quote with refresh',
    widgetAccessible: true, // required for window.FrontMcpBridge.callTool
    invocationStatus: { invoking: 'Fetching quote…', invoked: 'Quote loaded' },
    csp: {
      // CSP applies to the widget iframe — only allow fetches to our own market-data API.
      // Framework emits this on the resource's _meta.ui.csp so Claude honors it (#455).
      connectDomains: ['https://api.market.example'],
    },
    template: (ctx: TemplateContext<In, Out>) => {
      const initial = ctx.helpers.jsonEmbed(ctx.output);
      return `
        <div style="padding:16px;font-family:system-ui">
          <h2 style="margin:0">${ctx.helpers.escapeHtml(ctx.output.symbol)}</h2>
          <p id="price" style="font-size:36px;margin:8px 0">$${ctx.output.priceUsd.toFixed(2)}</p>
          <p id="asof" style="color:#666;margin:0">As of ${ctx.helpers.escapeHtml(ctx.output.asOf)}</p>
          <button id="refresh" style="margin-top:12px;padding:8px 16px">Refresh</button>
          <script>
            (function () {
              var current = ${initial};
              var btn = document.getElementById('refresh');
              btn.addEventListener('click', async function () {
                btn.disabled = true;
                btn.textContent = 'Refreshing…';
                try {
                  // FrontMcpBridge routes to OpenAI SDK / Claude postMessage / FrontMCP direct
                  // automatically. NEVER call window.openai.* directly — it breaks cross-host.
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
export class ShowQuoteTool extends ToolContext {
  async execute(input: In): Promise<Out> {
    const res = await this.fetch(`https://api.market.example/quote/${input.symbol}`);
    if (!res.ok) {
      this.fail(new PublicMcpError(`Quote upstream returned ${res.status} ${res.statusText}`));
    }
    const body = (await res.json()) as { price: number; ts: string };
    return { symbol: input.symbol, priceUsd: body.price, asOf: body.ts };
  }
}
```

## What This Demonstrates

- Restricting the widget's outbound `fetch` via `ui.csp.connectDomains` (emitted on the resource per #455)
- Opting the widget into cross-tool calls with `widgetAccessible: true` and using `window.FrontMcpBridge.callTool(name, args)` instead of host-specific APIs
- Embedding initial data into the widget's inline `<script>` safely via `ctx.helpers.jsonEmbed(...)` (escapes `</script>`)
- Surfacing in-flight status via `invocationStatus.invoking` / `invoked` so the host UI shows feedback

## Why these choices

- **`widgetAccessible: true`** — required for `window.FrontMcpBridge.callTool`. Without it, the bridge is read-only (the widget can read `getToolInput` / `getToolOutput` but can't invoke tools).
- **`csp.connectDomains`** — limits what the widget can `fetch` to. Without a CSP, the host's default applies (which may block everything in Claude). With `connectDomains: ['https://api.market.example']`, only that origin is reachable.
- **`window.FrontMcpBridge.callTool` not `window.openai.callTool`** — the bridge handles host detection. `window.openai.*` works on OpenAI Apps SDK but breaks everywhere else.
- **`jsonEmbed` not `JSON.stringify`** — `JSON.stringify` doesn't escape `</script>` and can break out of the inline script tag. `jsonEmbed` does.
