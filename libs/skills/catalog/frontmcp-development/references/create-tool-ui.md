---
name: create-tool-ui
description: Render an interactive UI widget for a tool's result via @Tool({ ui }), MCP Apps (SEP-1865), and the ui:// resource scheme
---

# Creating a Tool UI Widget (MCP Apps / SEP-1865)

The `@Tool({ ui })` option attaches an HTML widget to a tool's response. Supported hosts (OpenAI Apps SDK, Claude Artifacts, MCP Inspector, custom MCP clients) render the widget in a sandboxed iframe alongside the structured JSON output. FrontMCP routes the widget HTML through the MCP Apps extension ([SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)) using the `ui://widget/{toolName}.html` resource URI scheme.

This reference covers `ToolUIConfig` (re-exported from `@frontmcp/uipack/types`), the four supported template formats, serving and display modes, CSP / sanitization, the `window.FrontMcpBridge` runtime, and the platform-specific behavior you need to be aware of.

## When to Use This Skill

### Must Use

- Returning a tool result that's better presented as a rendered widget (dashboard, card, chart, form) than as raw JSON in chat
- Building tools for OpenAI Apps SDK, Claude Artifacts/MCP-UI, or other UI-capable MCP hosts
- Adding the `ui:` field to a `@Tool` decorator and you need to choose between the four template formats or six serving modes

### Recommended

- Letting the widget call other tools from within the iframe (set `widgetAccessible: true` + use `window.FrontMcpBridge`)
- Adding a `.tsx` or React widget — pick `FileSource` so esbuild + esm.sh transpile/serve it instead of bundling React into the server
- Hardening a widget that talks to an external API (configure `csp.connectDomains`)

### Skip When

- The host doesn't support widgets (Gemini, plain stdio inspectors) — leave `ui` unset and the response is JSON-only
- You only need plain Markdown in the chat transcript (return a string or structured output without `ui`)
- You're building a server-rendered MCP **resource** (see `create-resource`); `ui:` is for tool _responses_, not addressable resources

> **Decision:** Use this skill when a tool's _result_ should render as a widget. The widget is part of the tool response, not a separate resource you serve.

## Quick Start

```typescript
import { Tool, ToolContext, ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

const inputSchema = { location: z.string() };
const outputSchema = {
  location: z.string(),
  temperatureF: z.number(),
  conditions: z.string(),
};

type In = ToolInputOf<{ inputSchema: typeof inputSchema }>;
type Out = ToolOutputOf<{ outputSchema: typeof outputSchema }>;

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Current weather card',
    template: (ctx) => `
      <div style="padding:16px;font-family:system-ui">
        <h2>${ctx.helpers.escapeHtml(ctx.output.location)}</h2>
        <p style="font-size:48px;margin:8px 0">${ctx.output.temperatureF}°F</p>
        <p>${ctx.helpers.escapeHtml(ctx.output.conditions)}</p>
      </div>
    `,
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: In): Promise<Out> {
    return { location: input.location, temperatureF: 72, conditions: 'Sunny' };
  }
}
```

What this gets you:

- `tools/list` advertises the widget under `_meta['openai/outputTemplate']` (OpenAI clients) and registers the resource `ui://widget/get_weather.html` for hosts that fetch widgets via `resources/read`.
- On a Claude-style client, the response also embeds the rendered HTML inline in `_meta['ui/html']` as a fallback (dual-payload).
- On a host that doesn't understand any of the above, the structured JSON output renders as-is.

## Template Formats

`ui.template` accepts four shapes; the renderer auto-detects which one you gave it. Pick based on how much interactivity you need.

| Format                | Best for                                       | Where it runs                   | Notes                                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| **Function**          | Server-rendered HTML strings with helpers      | Server (Node)                   | `(ctx) => string` — most flexible; no client runtime needed                      |
| **HTML / MDX string** | Static markup or MDX with embedded data        | Server                          | String literal; templated via the `{{DATA}}` shell placeholder if present        |
| **React component**   | Stateful client-side UI (with `hydrate: true`) | Server SSR + optional hydration | Pass the component; `hydrate: false` (default) avoids React error #418 in Claude |
| **FileSource**        | `.tsx` / `.jsx` source files with `externals`  | Client (esm.sh transpile)       | `{ file: './widget.tsx' }`; CDN-loaded — use `externals` to skip bundling deps   |

### Function template (recommended starting point)

```typescript
import { type TemplateContext } from '@frontmcp/sdk';

ui: {
  template: (ctx: TemplateContext<MyInput, MyOutput>) =>
    `<div>${ctx.helpers.escapeHtml(ctx.output.label)}</div>`,
}
```

The function receives `TemplateContext<In, Out>`:

- `ctx.input` — validated tool input (typed)
- `ctx.output` — value returned from `execute()` (typed)
- `ctx.structuredContent` — JSON form of the output (when `outputSchema` is set)
- `ctx.helpers` — `escapeHtml`, `formatDate`, `formatCurrency`, `uniqueId`, `jsonEmbed`

> **Annotate `ctx` explicitly (TS7006).** Under `strict` / `noImplicitAny`, writing `template: (ctx) => …` without a type annotation fails with `Parameter 'ctx' implicitly has an 'any' type` (issue #442). Root cause: `template` is a union of multiple callable shapes (`TemplateBuilderFn<In, Out> | string | ((props: any) => any) | FileSource`), so TypeScript can't pick a single contextual type for the arrow's parameter. Either annotate `ctx: TemplateContext<In, Out>` as shown above, or sidestep the issue entirely by moving the widget to its own file and using the [FileSource](#filesource-tsx-widgets) form — recommended for anything non-trivial.

### HTML/MDX string template

```typescript
ui: {
  template: `
    # {{output.title}}
    <Card>Status: {{output.status}}</Card>
  `,
  mdxComponents: { Card: MyCardComponent },
}
```

### React component template

```typescript
import { WeatherWidget } from './weather.widget';

ui: {
  template: WeatherWidget,
  hydrate: false, // recommended for Claude/ChatGPT — avoids React error #418
}
```

> **About `hydrate`.** Default is `false`: SSR output is static HTML and the bridge IIFE handles interactivity. Enable `hydrate: true` only when you need client-side React state _and_ you've verified the host renders deterministic HTML.

### FileSource (`.tsx` widgets)

```typescript
ui: {
  template: { file: './chart-widget.tsx' },
  externals: ['chart.js', 'react-chartjs-2'],
  // OR explicit CDN overrides:
  dependencies: {
    'chart.js': {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
      integrity: 'sha512-…',
      global: 'Chart',
    },
  },
}
```

The file path is resolved at build/registration time; the bundler transpiles the `.tsx` and emits an import map that points listed `externals` at the CDN. The default CDN is `esm.sh`; pin to `cdnjs.cloudflare.com` via `dependencies` when targeting hosts with stricter CSP than `esm.sh` allows.

> **Claude target reality check (issue #447).** Claude Desktop / claude.ai render widgets in a sandboxed iframe whose CSP blocks **all** external `<script src="https://…">` execution — including `cdnjs.cloudflare.com`. The two FrontMCP fixes that make Claude rendering robust:
>
> - **`resourceMode: 'inline'`** is now the default for Claude (fixed in #456); leave the field unset and the framework host-detects. For other platforms the default remains `'cdn'` (smaller payload). When `'inline'` is selected — either explicitly or by host detection — the bundler inlines `react` / `react-dom` into the widget's `<script type="module">` (#454 fix), so no esm.sh import map / external module is needed and the widget runs under Claude's default CSP. Setting `resourceMode` explicitly always wins over auto-detection.
>   _Caveat_: host detection only applies to per-call rendering (inline / hybrid / lean modes). Static-mode widgets compile at startup with no client context — set `resourceMode: 'inline'` explicitly on `servingMode: 'static'` tools that target Claude.
> - **`ui.csp` is now emitted on the resource** (fixed in #455). Previously FrontMCP only attached `_meta.ui.csp` to the tool listing, and Claude (per the MCP Apps spec) only honors CSP declared on the resource content item. The framework now also attaches `_meta.ui.csp` / `_meta['ui/csp']` to the `resources/read` response for `ui://widget/{toolName}.html`, so `connectDomains` / `resourceDomains` you declare under `ui.csp` are honored by Claude.
>
> If you don't want React at all, a `uiType: 'html'` function template with a single inline `<script>` block also works on every host.

> **Prerequisite: install `@frontmcp/ui` (issue #443).** `.tsx`/`.jsx` FileSource widgets require the `@frontmcp/ui` package — the FrontMCP transpiler injects an auto-generated React mount that imports `McpBridgeProvider` from `@frontmcp/ui/react`. Without it, server-side bundling fails. Install it at the same version as `@frontmcp/sdk` (`npm install @frontmcp/ui` or `yarn add @frontmcp/ui`). `react` and `react-dom` stay external and load from the CDN at runtime — only `@frontmcp/ui` needs to be present in the consuming project for bundling to succeed.

> **Path resolution: relative paths are resolved against `process.cwd()`, not the tool file (issue #444).** A bare `template: { file: './widget.tsx' }` from `src/tools/foo.tool.ts` looks for `<cwd>/widget.tsx`, not `src/tools/widget.tsx` — and the mismatch only surfaces at tool-call time as `ENOENT`. Anchor the path to the tool source with `fileURLToPath(new URL('./widget.tsx', import.meta.url))` (from `node:url`), or pass an absolute path. The framework now throws a specific error pointing at this when an ENOENT happens on a relative FileSource path.

> **Name widget files `*.widget.tsx` / `*.widget.jsx` (issue #445).** `.tsx`/`.jsx` widget sources are bundled separately by uipack/esbuild at render time — they aren't subject to the server's `tsc --noEmit` pass. Newly scaffolded `tsconfig.json` files exclude `**/*.widget.tsx` / `**/*.widget.jsx` so widgets don't need the server tsconfig to set `jsx: 'react-jsx'` or pull in `@types/react`. Running `frontmcp init` on an existing project also adds the excludes if they're missing. Keep the `.widget.tsx` naming convention; if you want IDE/editor typecheck for widget sources, add a sibling `tsconfig.widget.json` with `jsx: 'react-jsx'` and `include: ['src/**/*.widget.tsx']`.

```typescript
import { fileURLToPath } from 'node:url';

const widgetPath = fileURLToPath(new URL('./chart-widget.tsx', import.meta.url));

ui: {
  template: { file: widgetPath },
  // ...
}
```

## Template Helpers

Available on `ctx.helpers` in function templates:

| Helper                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `escapeHtml(str)`              | Escape HTML entities; returns `''` for `null`/`undefined` |
| `formatDate(date, format?)`    | Locale-formatted date (Date or ISO string)                |
| `formatCurrency(amount, ccy?)` | ISO-4217 currency formatting (defaults to `'USD'`)        |
| `uniqueId(prefix?)`            | Deterministic unique ID for DOM elements                  |
| `jsonEmbed(data)`              | Safely embed JSON in `<script>` (escapes `</script>`)     |

Always run user-controlled strings through `escapeHtml` (or rely on the default sanitizer — see [Content Security](#content-security)).

## Serving Modes

`ui.servingMode` controls how the widget HTML is delivered. **Default `'auto'` is what you want in almost all cases.**

| Mode           | Where HTML lives                                                                         | Use when                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `'auto'`       | Picks `'inline'` for known UI clients, JSON-only for others                              | Default — let the SDK detect host capabilities                            |
| `'inline'`     | Embedded in tool response `_meta['ui/html']`                                             | Works on all UI hosts including network-blocked Claude Artifacts          |
| `'static'`     | Pre-compiled at startup; fetched via `resources/read` from `ui://widget/{toolName}.html` | OpenAI's template/discovery flow; widget doesn't change per call          |
| `'hybrid'`     | Shell pre-compiled; component code + data in `_meta['ui/component']`                     | React widgets that need a stable shell but per-call component code        |
| `'direct-url'` | HTTP endpoint on the MCP server (path from `directPath`)                                 | Avoid third-party-cookie issues (widget loads from your own origin)       |
| `'custom-url'` | Custom URL (CDN or external host)                                                        | Widget hosted elsewhere; pair with `customWidgetUrl` (supports `{token}`) |

```typescript
// Pre-compile at startup, expose as ui:// resource
ui: { template: MyWidget, servingMode: 'static' }

// Serve from /widgets/weather on the MCP server itself
ui: { template: MyWidget, servingMode: 'direct-url', directPath: '/widgets/weather' }

// CDN-hosted
ui: {
  template: MyWidget,
  servingMode: 'custom-url',
  customWidgetUrl: 'https://cdn.example.com/widgets/weather.html?token={token}',
}
```

## Resource URI Scheme

When `servingMode` is `'auto'` or `'static'`, FrontMCP registers a resource at:

```
ui://widget/{toolName}.html
```

You can override this with `resourceUri: 'ui://my-app/dashboard.html'`. The `ui://` URIs surface in:

- `tools/list` — under `_meta['openai/outputTemplate']` and `_meta['ui/resource']`
- `resources/list` — as discoverable resources
- `resources/read` — returns the compiled widget HTML with `MCP_APPS_MIME_TYPE`

The argument-completion flow (`completion/complete`) special-cases `ui://widget/` URIs to suggest tool names. Don't put non-widget content under that scheme.

## Display Mode

`ui.displayMode` is a hint to the host:

| Value          | Meaning                                     |
| -------------- | ------------------------------------------- |
| `'inline'`     | Render inline in the conversation (default) |
| `'fullscreen'` | Request fullscreen display                  |
| `'pip'`        | Picture-in-picture                          |

Hosts may ignore values they don't support.

## Content Security

Widgets render inside a double-iframe sandbox on both OpenAI and Claude:

```
Host ▶ Outer sandbox iframe (no parent cookies)
     ▶ Inner widget iframe (CSP-restricted)
       ▶ Your HTML
```

### `csp` — restrict iframe network access

```typescript
ui: {
  template: MyWidget,
  csp: {
    connectDomains: ['https://api.example.com'], // fetch / XHR / WebSocket
    resourceDomains: ['https://cdn.example.com'], // img / script / style / font
  },
}
```

Maps to CSP `connect-src` and `img-src` / `script-src` / `style-src` / `font-src` directives in the widget shell.

### `contentSecurity` — XSS / sanitization controls

| Field                | Default | Effect when `true`                                                |
| -------------------- | ------- | ----------------------------------------------------------------- |
| `allowUnsafeLinks`   | `false` | Allows `javascript:` / `data:` / `vbscript:` URL schemes in links |
| `allowInlineScripts` | `false` | Preserves `<script>` tags and `onclick`-style event handlers      |
| `bypassSanitization` | `false` | **Dangerous** — disables all HTML sanitization                    |

Keep defaults unless you have a specific, audited reason to disable. XSS contained by the sandbox can still steal widget state, exfiltrate via CSP-allowed domains, and phish the user.

## Widget Bridge (`window.FrontMcpBridge`)

When the widget needs to read/write data or invoke other tools, the bridge IIFE is injected automatically into every compiled widget shell. Set `widgetAccessible: true` to enable tool calls.

```typescript
ui: {
  template: (ctx) => `
    <button id="refresh">Refresh</button>
    <script>
      document.getElementById('refresh').onclick = async () => {
        const result = await window.FrontMcpBridge.callTool('get_weather', { location: 'NYC' });
        console.log(result);
      };
    </script>
  `,
  widgetAccessible: true,
}
```

Bridge methods available on `window.FrontMcpBridge`:

| Method                                       | Returns                  | Purpose                                                    |
| -------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `initialize()`                               | `void`                   | Auto-called; binds host adapter (OpenAI/Claude/Direct)     |
| `getToolInput()`                             | `unknown`                | Input passed to the tool that produced this widget         |
| `getToolOutput()`                            | `unknown`                | Raw output from the tool's `execute()`                     |
| `getStructuredContent()`                     | `unknown`                | Parsed structured output (matches `outputSchema`)          |
| `getWidgetState()` / `setWidgetState(state)` | `unknown` / `void`       | Read or persist per-widget state                           |
| `getHostContext()`                           | `{ theme, displayMode }` | Host-provided rendering context                            |
| `getTheme()` / `getDisplayMode()`            | string                   | Convenience getters                                        |
| `hasCapability(cap)`                         | `boolean`                | Probe adapter capabilities before calling `callTool` etc.  |
| `callTool(name, args)`                       | `Promise<unknown>`       | Invoke any tool the host allows (needs `widgetAccessible`) |
| `onToolResponseMetadata(cb)`                 | unsubscribe fn           | Subscribe to `ui/html` arrival (inline mode)               |

> **Why not `window.openai.callTool` directly?** The bridge routes to the right host API (OpenAI SDK, Claude postMessage, or FrontMCP direct injection) automatically. Calling `window.openai.*` works on OpenAI Apps SDK but breaks everywhere else.

## MCP Apps Options

| Option               | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `resourceUri`        | Override the auto-generated `ui://widget/{toolName}.html` URI                    |
| `widgetCapabilities` | Advertise `{ toolListChanged, supportsPartialInput }` at discovery time          |
| `prefersBorder`      | `_meta.ui.prefersBorder` — host renders a border around the iframe               |
| `sandboxDomain`      | `_meta.ui.domain` — dedicated origin for additional isolation                    |
| `invocationStatus`   | `{ invoking, invoked }` status strings shown during tool execution               |
| `htmlResponsePrefix` | Prefix text for Claude dual-payload mode (default `'Here is the visual result'`) |

## Rendering Options

| Option          | Default                                              | Effect                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uiType`        | `'auto'`                                             | Force renderer: `'html'`, `'react'`, `'mdx'`, `'markdown'`, or `'auto'` (detect)                                                                                                             |
| `bundlingMode`  | `'static'`                                           | `'static'` = pre-compile shell, inject data at runtime; `'dynamic'` = fresh HTML per call                                                                                                    |
| `resourceMode`  | `'cdn'` (host-detected — `'inline'` on Claude, #456) | `'cdn'` loads React/MDX/Handlebars from CDN; `'inline'` embeds them (and bundles React inline for `.tsx`/`.jsx` FileSource via #454). Leave unset to host-detect; set explicitly to opt out. |
| `hydrate`       | `false`                                              | Enable React hydration after SSR (only when you've verified no mismatches)                                                                                                                   |
| `customShell`   | —                                                    | `{ inline?, url?, npm? }` source for a custom HTML shell template                                                                                                                            |
| `mdxComponents` | —                                                    | Components available in MDX templates without imports                                                                                                                                        |

## Platform Considerations

| Host                 | Serving                 | Bridge adapter    | Constraints                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Apps SDK**  | `static` or `inline`    | `window.openai.*` | Any CDN; uses `_meta['openai/outputTemplate']`                                                                                                                                                                                                                                                                                           |
| **Claude (MCP-UI)**  | `inline` (dual-payload) | postMessage       | No external script execution in widget iframe by default. For `.tsx` FileSource widgets, set `resourceMode: 'inline'` so React is bundled in (#454). `ui.csp` is now also emitted on the resource (#455) so `connectDomains` / `resourceDomains` take effect. Non-React widgets can also use a self-contained `uiType: 'html'` template. |
| **MCP Inspector**    | `static`                | Direct            | Helpful for local development                                                                                                                                                                                                                                                                                                            |
| **Gemini / unknown** | skipped                 | n/a               | `ui` ignored; JSON output is returned                                                                                                                                                                                                                                                                                                    |

## Common Patterns

| Pattern                   | Correct                                                                                                        | Incorrect                                                            | Why                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Escaping user data        | `${ctx.helpers.escapeHtml(input.q)}`                                                                           | `${input.q}` in raw HTML                                             | Raw interpolation is XSS-prone; helper handles null/non-string                                                                 |
| Calling tools from widget | `window.FrontMcpBridge.callTool(...)`                                                                          | `window.openai.callTool(...)` directly                               | Bridge routes to the right host API; direct calls break cross-host                                                             |
| Claude-targeted widgets   | `.tsx` FileSource with `resourceMode: 'inline'` (React bundled in) OR self-contained `uiType: 'html'` template | Default `resourceMode: 'cdn'` for Claude (esm.sh import map blocked) | Claude blocks all external script execution; `resourceMode: 'inline'` (#454 fix) inlines React so the widget is self-contained |
| React widgets in Claude   | `hydrate: false`                                                                                               | `hydrate: true`                                                      | Hydration mismatches throw React error #418 in iframe sandboxes                                                                |
| Restricting fetch         | Set `csp.connectDomains` to the exact origins the widget calls                                                 | Omit `csp` and rely on defaults                                      | Default permits no external connects beyond the shell's own host                                                               |
| Widget URI                | Let SDK generate `ui://widget/{toolName}.html` (or set `resourceUri`)                                          | Mix non-widget content under `ui://widget/...`                       | Completion flow special-cases that scheme                                                                                      |

## Verification Checklist

### Configuration

- [ ] Tool has `ui:` set on `@Tool({…})`
- [ ] `template` is one of: function, HTML/MDX string, React component, or `{ file: '...' }` FileSource
- [ ] If template touches user data, it uses `ctx.helpers.escapeHtml(...)` (or leaves default sanitization on)
- [ ] `csp.connectDomains` declares every origin the widget will `fetch` / `WebSocket` to
- [ ] If targeting Claude, `dependencies` overrides only use `cdnjs.cloudflare.com`

### Runtime

- [ ] `resources/list` includes `ui://widget/{toolName}.html` (or your `resourceUri`)
- [ ] `resources/read` on that URI returns HTML with the `MCP_APPS_MIME_TYPE`
- [ ] `tools/list` exposes the widget under `_meta['openai/outputTemplate']`
- [ ] In Claude, tool response carries both JSON and `ui/html` blocks (dual-payload)
- [ ] On a non-UI client (e.g. plain stdio inspector), the tool still returns JSON without errors

## Troubleshooting

| Problem                                                  | Cause                                                                                                                             | Solution                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget renders blank in Claude                           | Default `resourceMode: 'cdn'` blocked by Claude's network policy                                                                  | Set `resourceMode: 'inline'` and route any `externals` through `cdnjs.cloudflare.com`                                                                                                                                        |
| "Loading widget…" hangs forever in Claude (FileSource)   | Default `resourceMode: 'cdn'` emits an esm.sh import map; Claude blocks all external script execution in the widget iframe (#447) | Set `resourceMode: 'inline'` on the `ui` config — `.tsx`/`.jsx` widgets now bundle React inline, no import map, no external module (#454 fix). For non-React widgets, a self-contained `uiType: 'html'` template also works. |
| React error #418 (hydration mismatch)                    | `hydrate: true` in a host that re-renders inconsistently                                                                          | Set `hydrate: false` (default) — bridge IIFE handles interactivity                                                                                                                                                           |
| `window.FrontMcpBridge.callTool` returns `undefined`     | `widgetAccessible: true` not set                                                                                                  | Add `widgetAccessible: true` to the `ui` block                                                                                                                                                                               |
| `_meta.ui.csp` declared on the tool is ignored by Claude | MCP Apps hosts (Claude) only honor CSP declared on the resource content item, not the tool (issue #455)                           | Use `csp: { connectDomains, resourceDomains }` inside the `ui:` block — the framework now also attaches it to the `resources/read` content's `_meta.ui.csp` (and `_meta['ui/csp']`) so Claude honors it. Fixed in #455.      |
| `resources/list` doesn't show the widget URI             | `servingMode: 'inline'` only — widget isn't pre-registered                                                                        | Use `'auto'` or `'static'` if you want a discoverable resource                                                                                                                                                               |
| Widget appears on OpenAI but JSON-only on Claude         | Claude needs dual-payload mode; happens automatically with `'auto'`                                                               | Confirm `servingMode` is `'auto'` (or `'inline'`); set `htmlResponsePrefix` to label the HTML block                                                                                                                          |
| `.tsx` file path resolves wrong (issue #444)             | Relative `template: { file }` resolved against `process.cwd()`                                                                    | Pass an absolute path — `fileURLToPath(new URL('./widget.tsx', import.meta.url))` from `node:url` — or anchor explicitly. The framework now throws a specific error pointing at this on ENOENT.                              |

## Packaging Notes

- **`@frontmcp/uipack`** — React-free core: shell builder, CSP, bridge IIFE generator, FileSource loader, esm.sh resolver. The `ToolUIConfig` type lives in `@frontmcp/uipack/types` and is re-exported from the SDK.
- **`@frontmcp/ui`** — React-based component library (Card, Button, Badge…) plus runtime renderers (mdx, html, react, pdf, csv, charts, mermaid, flow, math, maps, image, media) and React bridge hooks (`useMcpBridge`, `useCallTool`, `useToolInput`). Install separately if your widgets are React components.

Add to your `package.json` as needed:

```bash
yarn add @frontmcp/uipack          # core shell + bridge runtime (always available)
yarn add @frontmcp/ui              # React components, MUI theme, renderer suite
```

## Examples

| Example                                                                                  | Level        | Description                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-html-template`](../examples/create-tool-ui/basic-html-template.md)               | Basic        | A minimal function template that renders the tool output as a styled HTML card using `ctx.helpers.escapeHtml`.                                                                                 |
| [`widget-with-csp-and-bridge`](../examples/create-tool-ui/widget-with-csp-and-bridge.md) | Intermediate | An interactive widget that fetches from an allow-listed origin via `csp.connectDomains` and invokes another tool via `window.FrontMcpBridge.callTool`.                                         |
| [`file-source-tsx-widget`](../examples/create-tool-ui/file-source-tsx-widget.md)         | Advanced     | A `.tsx` FileSource widget that bundles a React chart component and renders in every host — including Claude — by setting `resourceMode: 'inline'` so React is inlined into the widget (#454). |

> See all examples in [`examples/create-tool-ui/`](../examples/create-tool-ui/)

## Reference

- [Building Tool UI guide](https://docs.agentfront.dev/frontmcp/guides/building-tool-ui)
- [MCP Apps (SEP-1865)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)
- `ToolUIConfig` type: `@frontmcp/uipack/types` (re-exported from `@frontmcp/sdk` as the `ui?:` option on `@Tool`)
- Related skills: `create-tool`, `create-tool-output-schema-types`, `create-resource`
