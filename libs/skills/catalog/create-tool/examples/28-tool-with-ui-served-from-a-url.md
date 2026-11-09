---
name: 28-tool-with-ui-served-from-a-url
level: advanced
description: "Tool widget served from a URL instead of from the `ui://` resource's own HTML: `servingMode: 'direct-url'` serves the page on a route of the server, and `'custom-url'` loads it from a CDN; the `ui://` resource frames that URL."
tags: [ui, direct-url, custom-url, frame-domains, serving-mode]
features:
  - "Serving the page compiled at startup on a server route with `servingMode: 'direct-url'` and `directPath`"
  - "Loading a page deployed elsewhere with `servingMode: 'custom-url'` and `customWidgetUrl`"
  - 'Rendering call data from the bridge (`tool:result`), because the page holds no call data'
  - 'Pinning the framed URL with `FRONTMCP_PUBLIC_URL`, and what the host must allow (`frameDomains`)'
---

# Tool With Ui Served From A Url

Tool widget served from a URL instead of from the `ui://` resource's own HTML: `servingMode: 'direct-url'` serves the page on a route of the server, and `'custom-url'` loads it from a CDN; the `ui://` resource frames that URL.

MCP Apps hosts and ChatGPT load widgets only from `ui://` resources. With a URL serving mode, the resource is a small page that frames the URL and relays the host's bridge messages, so the widget runs on its own origin.

## Code

```typescript
// src/apps/main/tools/get-forecast.tool.ts
import { Tool, ToolContext, z, type TemplateContext } from '@frontmcp/sdk';

const inputSchema = { city: z.string() };
const outputSchema = { city: z.string(), high: z.number() };

type Forecast = { city: string; high: number };

@Tool({
  name: 'get_forecast',
  description: 'Get the forecast high for a city',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'direct-url',
    // Served on GET https://<server>/widgets/forecast, without auth
    directPath: '/widgets/forecast',
    csp: { connectDomains: ['https://api.forecast.example'] },
    // Compiled once, at startup: ctx.output is {} here
    template: (ctx: TemplateContext<{ city: string }, Partial<Forecast>>) => ctx.helpers.html`
      <h2 id="forecast">Loading…</h2>
      <script>
        window.addEventListener('tool:result', function (event) {
          var data = event.detail.structuredContent;
          document.getElementById('forecast').textContent = data.city + ': ' + data.high + '°C';
        });
      </script>`,
  },
})
export class GetForecastTool extends ToolContext {
  async execute(input: { city: string }): Promise<Forecast> {
    return { city: input.city, high: 24 };
  }
}

@Tool({
  name: 'get_radar',
  description: 'Show the radar map for a city',
  inputSchema,
  ui: {
    servingMode: 'custom-url',
    // A page you deploy and update on your own; FrontMCP doesn't render `template` for it
    customWidgetUrl: 'https://widgets.forecast.example/radar.html',
    template: '',
  },
})
export class GetRadarTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, frames: 12 };
  }
}
```

```bash
# The framed URL starts with this origin; without it, with the scheme and Host the read came to
FRONTMCP_PUBLIC_URL=https://mcp.forecast.example
```

## What This Demonstrates

- Serving the page compiled at startup on a server route with `servingMode: 'direct-url'` and `directPath`
- Loading a page deployed elsewhere with `servingMode: 'custom-url'` and `customWidgetUrl`
- Rendering call data from the bridge (`tool:result`), because the page holds no call data
- Pinning the framed URL with `FRONTMCP_PUBLIC_URL`, and what the host must allow (`frameDomains`)

## Why these choices

- **The page holds no call data.** Results carry no page, and nothing per call is ever put in a URL; the host sends each call's result to the widget, which draws it on `tool:result`. The `directPath` route answers without auth in every auth mode (a frame sends no credentials), so keep secrets out of the template.
- **`frameDomains`** — the `ui://` resource declares the URL's origin as a frame (`_meta.ui.csp.frameDomains`, `_meta['openai/widgetCSP'].frame_domains`). ChatGPT asks for a justification of frame domains when an app is submitted.
- **No `window.openai` in the frame** — the bridge talks to the host over the MCP Apps protocol, which ChatGPT supports too. `window.FrontMcpBridge` works the same.
- **`custom-url` pages bring their own bridge** — build the page with `buildShell()` from `@frontmcp/uipack/shell` (FrontMCP's bridge and the `tool:result` event), or use `@modelcontextprotocol/ext-apps`. The page must allow framing, and its URL can't hold a `{token}` placeholder or credentials: startup refuses them.
- **Startup checks the route** — a `directPath` that collides with another route of the server, a FrontMCP endpoint or another widget stops the server with `InvalidToolUiConfigError`.

See `references/ui-widgets.md` ("Serving a widget from a URL") for the full contract.
