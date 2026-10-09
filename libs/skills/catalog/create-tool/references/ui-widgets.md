---
name: ui-widgets
description: '@Tool({ ui }) — template formats, trusted markup (html / escapeStringResults), servingMode, host-detect resourceMode, CSP, ignored options, MCP Apps spec.'
---

# Tool UI widgets

The `ui:` field on `@Tool({...})` attaches an HTML widget to the tool's response. Supported hosts (OpenAI Apps SDK, Claude Artifacts, MCP Inspector) render the widget in a sandboxed iframe alongside the JSON output, using the MCP Apps extension ([SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)) and the `ui://widget/{toolName}.html` resource URI scheme.

## Quick recipe

```typescript
import { fileURLToPath } from 'node:url';

const widgetPath = fileURLToPath(new URL('./weather.widget.tsx', import.meta.url));

@Tool({
  name: 'get_weather',
  description: 'Current weather for a city',
  inputSchema,
  outputSchema,
  ui: {
    template: { file: widgetPath },
    widgetDescription: 'Current weather card',
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: GetWeatherInput): Promise<GetWeatherOutput> {
    /* … */
  }
}
```

That's it. The framework:

- Advertises the widget at `ui://widget/get_weather.html` in `tools/list` and renders it per call into that call's `_meta['ui/html']` (default `servingMode: 'auto'` → `inline`). With `servingMode: 'static'` it pre-compiles the widget at startup and serves it from `resources/read`.
- Auto-detects the connecting client — `resourceMode: 'inline'` for Claude (React bundled in), `'cdn'` for OpenAI / ChatGPT / Cursor (esm.sh import map, smaller payload).
- Emits `ui.csp` (if set) on the resource's `_meta.ui.csp` with the MCP Apps `connectDomains` / `resourceDomains` keys — Claude actually honors it (it ignores CSP declared on the tool). The snake_case keys sent up to 1.9.2 stay alongside.

## Template formats

| Format                       | Shape                                   | When                                                                                                                                    |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **FileSource (recommended)** | `{ file: widgetPath }`                  | `.tsx` / `.jsx` / `.html` source files. Anchor with `import.meta.url`.                                                                  |
| **Function**                 | `` (ctx) => ctx.helpers.html`…` ``      | Quick demo / one-liner HTML. Annotate `ctx: TemplateContext<In, Out>` ([why](#typescript-gotcha-ts7006)).                               |
| **HTML / Markdown string**   | `'<div>…</div>'` or `'# Title\n- item'` | A string with both `<` and `>` is HTML as written; any other string is Markdown, converted on the server. MDX is **not** compiled.      |
| **React component**          | `MyWidget`                              | Not supported: a bare component reference cannot be bundled, so the page is an empty root. Startup warns once per tool; use `{ file }`. |

The renderer auto-detects which one you passed.

## TypeScript gotcha (TS7006)

Inline `template: (ctx) => …` under `strict` fails with `Parameter 'ctx' implicitly has an 'any' type` — `ui.template` is a union of multiple callable shapes so TypeScript can't pick a contextual type. Annotate explicitly:

```typescript
import { type TemplateContext } from '@frontmcp/sdk';

ui: {
  template: (ctx: TemplateContext<MyInput, MyOutput>) => ctx.helpers.html`<div>${ctx.output.label}</div>`,
}
```

Or use the FileSource form — it sidesteps the issue.

## `ToolUIConfig` fields

| Field                                                                   | Default     | Purpose                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `template`                                                              | —           | Required. `{ file }` FileSource (recommended) / function / HTML or Markdown string / React component.                                                                                                                                                                                                            |
| `widgetDescription`                                                     | —           | Sent on the widget resource as `_meta['openai/widgetDescription']`, which the model reads when the widget loads.                                                                                                                                                                                                 |
| `servingMode`                                                           | `'auto'`    | `'inline'` / `'static'` / `'hybrid'`. `'auto'` picks the best per-host. `'direct-url'` / `'custom-url'` are not implemented (served inline, startup warning). `'hybrid'` sends only `_meta['ui/component']` = `{ type, hash, toolName }`, no code. Unset: the app's, then the server's `ui.servingMode` default. |
| `displayMode`                                                           | `'inline'`  | `'fullscreen'` / `'pip'`: the page asks the host for it once the bridge connects, if the host offers it (`ui/request-display-mode`, or `window.openai.requestDisplayMode()`); the host may refuse.                                                                                                               |
| `preferredHeight`                                                       | —           | `number` (px) or CSS string (`'50vh'`). Initial widget height; auto-resize grows/shrinks from this baseline.                                                                                                                                                                                                     |
| `minHeight` / `maxHeight`                                               | —           | `number` (px) or CSS string. Clamp the widget height; auto-resize never reports outside this range.                                                                                                                                                                                                              |
| `aspectRatio`                                                           | —           | CSS `aspect-ratio` (`'16 / 9'` or `1.5`). Hosts that honor it size by ratio instead of measured height.                                                                                                                                                                                                          |
| `autoResize`                                                            | `true`      | Report the document height (margins included) to the host after the handshake. Set `false` to opt out (CSS still applies).                                                                                                                                                                                       |
| `csp`                                                                   | —           | `{ connectDomains?, resourceDomains? }` — emitted on the resource content's `_meta.ui.csp` (#455) with these keys, and as `_meta['openai/widgetCSP']` in snake_case. Claude honors CSP only here. See [CSP origins](#csp-origins).                                                                               |
| `contentSecurity`                                                       | strict      | **No effect yet.**                                                                                                                                                                                                                                                                                               |
| `escapeStringResults`                                                   | unset       | Unset (the default since 1.9.2) and `true` escape plain string results of a template function (unset logs a one-time notice); `false` renders them as markup; `html` / `trustedHtml` stay markup.                                                                                                                |
| `widgetAccessible`                                                      | `false`     | Sent in `tools/list` as `_meta['openai/widgetAccessible']`, which the OpenAI Apps SDK requires for `window.openai.callTool()`.                                                                                                                                                                                   |
| `resourceUri`                                                           | auto        | Override the `ui://widget/{toolName}.html` URI.                                                                                                                                                                                                                                                                  |
| `uiType`                                                                | `'auto'`    | **No effect yet** — the type is auto-detected.                                                                                                                                                                                                                                                                   |
| `resourceMode`                                                          | host-detect | `'cdn'` / `'inline'`. Leave unset — the framework host-detects (Claude → `'inline'`, #456).                                                                                                                                                                                                                      |
| `hydrate`                                                               | `false`     | **No effect yet.**                                                                                                                                                                                                                                                                                               |
| `externals`, `dependencies`                                             | —           | CDN externals for FileSource widgets.                                                                                                                                                                                                                                                                            |
| `customShell`, `invocationStatus`, `widgetCapabilities`                 | —           | Platform-specific knobs.                                                                                                                                                                                                                                                                                         |
| `prefersBorder`, `sandboxDomain`                                        | —           | Sent on the widget resource as `_meta.ui.prefersBorder` / `_meta.ui.domain` (MCP Apps) and `_meta['openai/widgetPrefersBorder']` / `_meta['openai/widgetDomain']`.                                                                                                                                               |
| `runtimeOptions`, `mdxComponents`, `bundlingMode`, `htmlResponsePrefix` | —           | **No effect yet.** There is no dual HTML payload for Claude.                                                                                                                                                                                                                                                     |

## Components and hooks

`@frontmcp/ui` has **no** `card()`, `badge()`, `descriptionList()`, `button()`, `form()` or `input()` functions. Widgets use React: components from `@frontmcp/ui/components` (`Alert`, `Avatar`, `Badge`, `Button`, `Card`, `List`, `Loader`, `Modal`, `Select`, `Table`, `TextField`) and bridge hooks from `@frontmcp/ui/react` (`useToolInput`, `useToolOutput`, `useCallTool`, `useTheme`, `useHostContext`, ...). A `.tsx` widget receives `{ output, loading }`.

`useCallTool` returns a **tuple**, not an object:

```tsx
import { Card } from '@frontmcp/ui/components';
import { useCallTool } from '@frontmcp/ui/react';

export default function Widget({ output }: { output: { id: string } | null }) {
  const [refresh, { data, loading, error, called }, reset] = useCallTool('get_order');
  if (!output) return <Card title="Loading..." />;
  return (
    <button disabled={loading} onClick={() => refresh({ orderId: output.id })}>
      Refresh
    </button>
  );
}
```

## Markdown, MDX and sanitization

- A string template with both `<` and `>` is HTML and is used as written. Any other string is Markdown: headings, paragraphs, fenced code, lists, bold, italic, inline code and links are converted server-side; raw HTML is escaped; a link survives only if its target starts with `http:`, `https:`, `mailto:`, `/` or `#`.
- MDX is not compiled: `{output.field}` expressions are not evaluated and `mdxComponents` is ignored. Use a `.tsx` FileSource widget for interactivity.
- Author-written markup (template literals, HTML strings, `.tsx`) is trusted and not sanitized. Values interpolated into `` html`…` `` are escaped; plain string results are escaped unless `escapeStringResults: false`.

## Widget resources and per-call renders

- `resources/read ui://widget/{toolName}.html` serves only what was compiled at startup (`static`, the `hybrid` shell), rendered without caller data, or a data-free placeholder that gets the result through the bridge.
- An `inline` render embeds the call's input and output. It is returned only in that call's `_meta['ui/html']` and is never cached where `resources/read` can serve it, so one caller can't read another caller's widget (GHSA-rhr9-vhpf-jqp7).
- A page compiled at startup injects no call data (`window.__mcpToolInput` / `window.__mcpToolOutput` are `null`), so the bridge takes the result from the host: `window.openai.toolOutput` (ChatGPT, read at load and followed after) or `ui/notifications/tool-result` (MCP Apps). A `.tsx` widget renders with `loading: true` until it arrives, and `useToolOutput()` returns `null` until then.
- Hosts that load the widget via `resources/read` (MCP Apps hosts such as Claude) need `servingMode: 'static'` and a template that reads data from `window.FrontMcpBridge`; set `resourceMode: 'inline'` explicitly for Claude in static mode.
- With the default `servingMode`, every `tools/call` result carries the page in `_meta['ui/html']` — hosts that load the `ui://` resource don't read it, so use `servingMode: 'static'` to leave it out. Set it once instead of per tool: `@FrontMcp({ ui: { servingMode: 'static' } })` for every tool, or `@App({ ui: { servingMode } })` for one app's tools. Precedence: the tool's own `ui.servingMode` > app > server > `'auto'`; the defaults take the same values (anything else fails startup), and a `'direct-url'` / `'custom-url'` / `'hybrid'` default logs one notice per server or app. `'auto'` stays `inline` in 1.9.x. A call the widget makes back gets the data only: through `ui/callServerTool`, or a `tools/call` that `FrontMcpBridge.callTool()` sends through an MCP Apps host (marked `_meta['frontmcp/widgetCall']: true`, kept when the host passes `_meta` on). `window.openai.callTool()` sends no `_meta`, so under the OpenAI Apps SDK the page still comes back.
- The advertised URI percent-encodes the tool name (`app:tool` → `ui://widget/app%3Atool.html`). Encoded and raw forms both read back; a name that decodes to anything outside `A-Z a-z 0-9 _ - . / : @` is rejected.

## CSP origins

The page FrontMCP writes also carries its own Content-Security-Policy built from `ui.csp`:

- An origin must be `https://` or `wss://` (a WebSocket API needs `wss://` in `connectDomains`), a `https://*.` / `wss://*.` wildcard, or `http://` / `ws://` on `localhost` / `127.0.0.1` / `[::1]`.
- Declared origins are added to what the page already reaches: the CDNs and `resourceDomains` stay in `connect-src`.
- Any other origin (bare host, `ftp://`, plain `http://` host, a value with a `?query` or `#fragment`) is left out of the page policy; startup logs a warning naming the tool and the origin. The resource `_meta.ui.csp` keeps the origins as written.

```typescript
ui: {
  template: { file: widgetPath },
  csp: {
    connectDomains: ['https://api.example.com', 'wss://live.example.com'],
    resourceDomains: ['https://cdn.example.com'],
  },
}
```

## Trusted markup and escaping template results

Build function-template markup with the `ctx.helpers.html` tagged template. Literal parts stay markup; every interpolated value is HTML-escaped unless it is itself trusted markup:

```typescript
template: (ctx: TemplateContext<In, Out>) => {
  const { html } = ctx.helpers;
  return html`
    <h2>${ctx.output.title}</h2>
    <ul>${ctx.output.items.map((item) => html`<li>${item.name}</li>`)}</ul>
  `;
},
```

- Nested `html` values are never escaped twice; arrays are joined without a separator; `null` / `undefined` / `false` render nothing. Don't pre-escape with `escapeHtml` inside `html` (double escaping). Quote attribute values; escaping doesn't validate `href` / `src` URLs.
- `ctx.helpers.trustedHtml(markup)` marks markup you produced or sanitized yourself as trusted. Never wrap raw tool output or user input.
- In an inline `<script>`, embed data with `${trustedHtml(jsonEmbed(data))}` — `jsonEmbed` writes `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX`, so it is safe in a script, and `html` would otherwise HTML-escape its quotes.
- `html`, `trustedHtml`, `isTrustedHtml` and `TrustedHtml` are also exported from `@frontmcp/uipack`; `TrustedHtml` is re-exported from `@frontmcp/sdk`.

A **plain string** a template function returns is escaped and shown as text (since 1.9.2) — `template: (ctx) => ctx.output` cannot inject tags. `escapeStringResults: false` opts out:

| `escapeStringResults` | Plain string result                               | `html` / `trustedHtml` result |
| --------------------- | ------------------------------------------------- | ----------------------------- |
| unset (since 1.9.2)   | Escaped; one-time notice if it looked like markup | Markup                        |
| `true`                | Escaped, no notice                                | Markup                        |
| `false`               | Rendered as markup when it looks like HTML        | Markup                        |

Set it per tool (`ui: { escapeStringResults: false }`) or server-wide (`@FrontMcp({ ui: { escapeStringResults: false } })`; the tool setting wins). Prefer returning `html` / `trustedHtml` from every template function; a widget that shows its markup as text after upgrading to 1.9.2 returns a plain string.

Everything else is always escaped: plain text as text, objects as JSON inside `<pre>`, chart configs and base64 PDFs (`JVBERi…`) as script data. A value that starts with `JVBERi` but isn't base64 is shown as text. A static string template (`template: '<div>…</div>'`) is author markup and is never escaped.

## Path resolution gotcha (#444)

Bare `template: { file: './widget.tsx' }` resolves against `process.cwd()`, **not** the tool file. Always anchor:

```typescript
import { fileURLToPath } from 'node:url';

const widgetPath = fileURLToPath(new URL('./weather.widget.tsx', import.meta.url));
ui: {
  template: {
    file: widgetPath,
  },
}
```

See [`rules/widget-paths-anchor-with-import-meta-url.md`](../rules/widget-paths-anchor-with-import-meta-url.md).

The widget is read when the tool is called, from the path the **compiled** tool computes — an anchored path points into the build output once the tool is compiled, so the file has to ship there (#649):

- `frontmcp build` copies every `*.widget.tsx` / `*.widget.jsx` under the entry's directory into the output. tsc-output targets (`distributed`, `cloudflare`) get them at the same relative path, next to each compiled tool. Bundled targets (`node`, `cli`, `lambda`, `vercel`) get them directly next to the bundle, because every bundled module's `__dirname` is the bundle's directory — keep each widget beside its tool and give it a unique file name (the build skips, and warns about, names used twice).
- Only widget files are copied, not other local files a widget imports.
- A plain `tsc` build copies nothing — add a copy step. A missing widget fails the call with an `ENOENT` error naming the path it looked for, and the `src/` file when one matches.

## `@frontmcp/ui` prerequisite (#443)

`.tsx` / `.jsx` FileSource widgets require `@frontmcp/ui` in the consuming project — the bundler injects an auto-generated React mount that imports `McpBridgeProvider` from `@frontmcp/ui/react`:

```bash
npm install @frontmcp/ui
# or: yarn add @frontmcp/ui  /  pnpm add @frontmcp/ui
```

Match the version to `@frontmcp/sdk`. Without it, server-side bundling fails with a friendly error pointing at this requirement.

## `esbuild` prerequisite (#649)

`@frontmcp/uipack` loads `esbuild` on demand to bundle a `.tsx` / `.jsx` widget **when the tool is called**, so it must be installed where the server runs — as a runtime dependency:

```bash
npm install esbuild   # in "dependencies", not "devDependencies"
```

Projects created with `frontmcp create` already have it through the `frontmcp` package. `@frontmcp/uipack` declares it as an optional peer dependency (`>=0.27.0 <1`). Without it, the call fails with an error naming the widget. Bundling works the same in CommonJS and ES-module (`"type": "module"`) projects.

## Widget bridge — `window.FrontMcpBridge`

When the widget needs to read tool data or invoke other tools, the bridge IIFE is injected automatically; no option is needed (under the OpenAI Apps SDK, set `widgetAccessible: true` so the host lets the widget call tools):

```typescript
ui: {
  template: (ctx) => ctx.helpers.html`
    <button id="refresh">Refresh</button>
    <script>
      document.getElementById('refresh').onclick = async () => {
        const result = await window.FrontMcpBridge.callTool('get_weather', { city: 'NYC' });
        console.log(result);
      };
    </script>
  `,
}
```

| Bridge method                                                   | Purpose                                                |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| `callTool(name, args)`                                          | Invoke another tool (the host may still refuse)        |
| `getToolInput()` / `getToolOutput()` / `getStructuredContent()` | Read the tool data                                     |
| `getWidgetState()` / `setWidgetState(state)`                    | Persisted per-widget state                             |
| `getHostContext()` / `getTheme()` / `getDisplayMode()`          | Host context                                           |
| `onContextChange(cb)`                                           | Subscribe to host context changes (handshake included) |
| `hasCapability(cap)`                                            | Probe adapter capabilities                             |
| `onToolResponseMetadata(cb)`                                    | Subscribe to `ui/html` arrival (inline mode)           |

The bridge routes to the right host adapter (OpenAI SDK / Claude postMessage / FrontMCP direct) automatically. **Never call `window.openai.*` directly** — it works on OpenAI but breaks everywhere else.

### Theme

The page follows the host theme. When an MCP Apps host sends `theme: 'light' | 'dark'` — in the `ui/initialize` result or a later `ui/notifications/host-context-changed` — the bridge sets `<meta name="color-scheme" content="…">` and `<html data-theme="…">`:

- The frame's canvas and form controls match the host (a dark host no longer gets an opaque white frame).
- Style dark mode with `[data-theme='dark'] …` selectors.
- `getTheme()` returns the same value; `onContextChange` listeners fire for the handshake context too.
- Nothing is written when the host sends no theme (the OS fallback `getTheme()` starts with is never applied).
- A widget styled for light only keeps it with `:root { color-scheme: light }` — author CSS wins over the meta tag.

## Host considerations

| Host                 | Notes                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Apps SDK**  | Any CDN works. The widget is advertised the same way as for every host — `tools/list` emits `_meta.ui.resourceUri` pointing at `ui://widget/{toolName}.html` (the MCP Apps `ui/*` namespace); there is no `openai/outputTemplate` key. |
| **Claude (MCP-UI)**  | Widget iframe blocks all external script execution. Use `resourceMode: 'inline'` (auto-detected when you leave it unset) so React bundles in. CSP must be on the resource — framework handles it via `ui.csp` (#455 fix).              |
| **MCP Inspector**    | Useful for local development. Static mode works fine.                                                                                                                                                                                  |
| **Gemini / unknown** | `ui` is ignored — JSON output is returned.                                                                                                                                                                                             |

The host is decided when the client connects: a `transport.platformDetection.mappings` entry matching the client name wins; then a client that declares the MCP Apps extension (`io.modelcontextprotocol/ui`) is `ext-apps` whatever its name (`gemini-cli` included); then the client name. Opt a client out of MCP Apps with a mapping: `platformDetection: { mappings: [{ pattern: 'gemini-cli', platform: 'gemini' }] }`.

## Widget sizing

Set sizing in the `ui` config — no hand-rolled `ui/notifications/size-changed` + `ResizeObserver` needed:

```typescript
ui: {
  template: MediaPlayerWidget,
  preferredHeight: 480,   // number → px; or a CSS string like '50vh'
  minHeight: 200,
  maxHeight: '80vh',
  aspectRatio: '16 / 9',  // optional; '16 / 9' or a number like 1.78
  autoResize: true,       // default; reports content height as it changes
}
```

What FrontMCP does with it:

- **Static sizing CSS** — `preferredHeight` (initial `height`), `minHeight`, `maxHeight`, and `aspectRatio` are injected as a `<style>` block on `html` / `body` / `#root`, so the widget opens at the right size before any JS runs.
- **`_meta` hints** — the same values ride along on the response/discovery `_meta` as `ui/preferredHeight`, `ui/minHeight`, `ui/maxHeight`, `ui/aspectRatio` (and nested under `_meta.ui` in `tools/list`), so hosts that read sizing from metadata pick it up.
- **Runtime auto-resize** — when `autoResize !== false` and `ResizeObserver` is available, the bridge observes `<html>`, `<body>` and `#root` and reports the page height to the host (debounced via `requestAnimationFrame`), also firing a `widget:resize` event you can listen for. Call `window.FrontMcpBridge.setSize({ height, width, aspectRatio })` to report manually.
- **What is measured** — the whole document: `<html>` at `height: fit-content`, plus any content overflowing a fixed-height `<body>`, clamped by a px `max-height` on `<html>`. Body margins and margins collapsed through the body (an `<h2>` or `<ul>` at the edge) are counted, and the height shrinks when content does. `preferredHeight` / `minHeight` / `maxHeight` act as the floor and ceiling.
- **When it is sent** — auto-resize reports wait for the bridge to initialize. In an ext-apps host the first report is sent after the `ui/initialize` handshake settles. `ui/notifications/size-changed` is a notification, so the host never answers it; it is refused locally (the promise rejects) only when no trusted origin exists, and auto-resize then retries that height on a later observation. A manual `setSize` called before the handshake, with no trusted origin configured, is held and only the latest size is sent right after it. `aspectRatio` stays part of the cross-platform `FrontMcpBridge.setSize` API; the ext-apps adapter leaves it out of the notification payload.

Per-host behavior:

- **Claude / static widgets** — the host measures the iframe DOM height itself, so auto-resize is effectively CSS-only (the `setSize` report is a no-op). The injected CSS is what makes a fixed-tall widget (media players, canvases) open without clipping.
- **OpenAI ChatGPT** — auto-resize forwards to the Apps SDK sizing API when one is exposed; otherwise the SDK's own DOM measurement applies.
- **ext-apps hosts** — the measured size is reported with the standard `ui/notifications/size-changed` notification (`{ width, height }` in px), which any spec-compliant host handles.
- **Gemini / generic / unknown** — `setSize` is a no-op; only the static CSS applies.

`displayMode: 'fullscreen'` is separate: the page asks the host for that mode once the bridge connects, and the host may refuse. On an MCP Apps host the bridge declares `inline`, `fullscreen` and `pip` in `ui/initialize` (`appCapabilities.availableDisplayModes`), asks only for a mode the host lists in `hostContext.availableDisplayModes`, and keeps the mode the host answers with.

## Current limitations

- **Don't push large payloads through the widget.** Claude's sandbox CSP blocks external `connect-src`, so an inline widget can't reliably lazy-load multi-MB data, and a single MCP message is a poor carrier for it either. For large or streamed data, return a `resource_link` (see [`output-schema.md`](./output-schema.md)) and let the host fetch the resource — don't embed it in the widget or the tool result.

## Examples

- [`22-tool-with-ui-html-template`](../examples/22-tool-with-ui-html-template.md) — inline function template
- [`23-tool-with-ui-filesource-tsx`](../examples/23-tool-with-ui-filesource-tsx.md) — `.tsx` widget, host-detect
- [`24-tool-with-ui-csp-and-bridge`](../examples/24-tool-with-ui-csp-and-bridge.md) — CSP + bridge `callTool`

## Related rules

- [`rules/widget-paths-anchor-with-import-meta-url.md`](../rules/widget-paths-anchor-with-import-meta-url.md)
- [`rules/widget-resource-mode-host-detect.md`](../rules/widget-resource-mode-host-detect.md)
