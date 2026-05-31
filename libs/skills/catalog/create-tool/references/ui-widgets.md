---
name: ui-widgets
description: @Tool({ ui }) — template formats, servingMode, host-detect resourceMode, CSP, widgetAccessible, MCP Apps spec.
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

- Pre-compiles the widget at startup, registers it at `ui://widget/get_weather.html`.
- Auto-detects the connecting client — `resourceMode: 'inline'` for Claude (React bundled in), `'cdn'` for OpenAI / ChatGPT / Cursor (esm.sh import map, smaller payload).
- Emits `ui.csp` (if set) on the resource's `_meta.ui.csp` — Claude actually honors it (it ignores CSP declared on the tool).

## Template formats

| Format                       | Shape                                     | When                                                                                                      |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **FileSource (recommended)** | `{ file: widgetPath }`                    | `.tsx` / `.jsx` / `.html` source files. Anchor with `import.meta.url`.                                    |
| **Function**                 | `(ctx) => string`                         | Quick demo / one-liner HTML. Annotate `ctx: TemplateContext<In, Out>` ([why](#typescript-gotcha-ts7006)). |
| **HTML / MDX string**        | `'<div>…</div>'` or `'# Title\n<Card />'` | Static markup; pair with `mdxComponents` for MDX.                                                         |
| **React component**          | `MyWidget`                                | SSR React. Set `hydrate: false` (default) for Claude/ChatGPT.                                             |

The renderer auto-detects which one you passed.

## TypeScript gotcha (TS7006)

Inline `template: (ctx) => …` under `strict` fails with `Parameter 'ctx' implicitly has an 'any' type` — `ui.template` is a union of multiple callable shapes so TypeScript can't pick a contextual type. Annotate explicitly:

```typescript
import { type TemplateContext } from '@frontmcp/sdk';

ui: {
  template: (ctx: TemplateContext<MyInput, MyOutput>) =>
    `<div>${ctx.helpers.escapeHtml(ctx.output.label)}</div>`,
}
```

Or use the FileSource form — it sidesteps the issue.

## `ToolUIConfig` fields

| Field                                                                                                           | Default     | Purpose                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `template`                                                                                                      | —           | Required. Function / HTML-string / React component / `{ file }` FileSource.                                                     |
| `widgetDescription`                                                                                             | —           | Human-readable description surfaced to the host UI.                                                                             |
| `servingMode`                                                                                                   | `'auto'`    | `'inline'` / `'static'` / `'hybrid'` / `'direct-url'` / `'custom-url'`. `'auto'` picks the best per-host.                       |
| `displayMode`                                                                                                   | `'inline'`  | `'inline'` / `'fullscreen'` / `'pip'` — host display hint.                                                                      |
| `preferredHeight`                                                                                               | —           | `number` (px) or CSS string (`'50vh'`). Initial widget height; auto-resize grows/shrinks from this baseline.                    |
| `minHeight` / `maxHeight`                                                                                       | —           | `number` (px) or CSS string. Clamp the widget height; auto-resize never reports outside this range.                             |
| `aspectRatio`                                                                                                   | —           | CSS `aspect-ratio` (`'16 / 9'` or `1.5`). Hosts that honor it size by ratio instead of measured height.                         |
| `autoResize`                                                                                                    | `true`      | Auto-report content height to the host via a debounced `ResizeObserver` on `#root`. Set `false` to opt out (CSS still applies). |
| `csp`                                                                                                           | —           | `{ connectDomains?, resourceDomains? }` — emitted on the resource content's `_meta.ui.csp` (#455). Claude honors CSP only here. |
| `contentSecurity`                                                                                               | strict      | `{ allowUnsafeLinks?, allowInlineScripts?, bypassSanitization? }` — keep defaults.                                              |
| `widgetAccessible`                                                                                              | `false`     | `true` exposes `window.FrontMcpBridge.callTool` in the widget.                                                                  |
| `resourceUri`                                                                                                   | auto        | Override the `ui://widget/{toolName}.html` URI.                                                                                 |
| `uiType`                                                                                                        | `'auto'`    | Force `'html'` / `'react'` / `'mdx'` / `'markdown'`.                                                                            |
| `resourceMode`                                                                                                  | host-detect | `'cdn'` / `'inline'`. Leave unset — the framework host-detects (Claude → `'inline'`, #456).                                     |
| `hydrate`                                                                                                       | `false`     | Enable React hydration after SSR. Off by default — avoids React error #418 in Claude.                                           |
| `externals`, `dependencies`                                                                                     | —           | CDN externals for FileSource widgets.                                                                                           |
| `customShell`, `invocationStatus`, `widgetCapabilities`, `prefersBorder`, `sandboxDomain`, `htmlResponsePrefix` | —           | Platform-specific knobs.                                                                                                        |

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

## `@frontmcp/ui` prerequisite (#443)

`.tsx` / `.jsx` FileSource widgets require `@frontmcp/ui` in the consuming project — the bundler injects an auto-generated React mount that imports `McpBridgeProvider` from `@frontmcp/ui/react`:

```bash
npm install @frontmcp/ui
# or: yarn add @frontmcp/ui  /  pnpm add @frontmcp/ui
```

Match the version to `@frontmcp/sdk`. Without it, server-side bundling fails with a friendly error pointing at this requirement.

## Widget bridge — `window.FrontMcpBridge`

When the widget needs to read tool data or invoke other tools, the bridge IIFE is injected automatically. Set `widgetAccessible: true` to enable `callTool`:

```typescript
ui: {
  template: (ctx) => `
    <button id="refresh">Refresh</button>
    <script>
      document.getElementById('refresh').onclick = async () => {
        const result = await window.FrontMcpBridge.callTool('get_weather', { city: 'NYC' });
        console.log(result);
      };
    </script>
  `,
  widgetAccessible: true,
}
```

| Bridge method                                                   | Purpose                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `callTool(name, args)`                                          | Invoke another tool (requires `widgetAccessible: true`) |
| `getToolInput()` / `getToolOutput()` / `getStructuredContent()` | Read the tool data                                      |
| `getWidgetState()` / `setWidgetState(state)`                    | Persisted per-widget state                              |
| `getHostContext()` / `getTheme()` / `getDisplayMode()`          | Host context                                            |
| `hasCapability(cap)`                                            | Probe adapter capabilities                              |
| `onToolResponseMetadata(cb)`                                    | Subscribe to `ui/html` arrival (inline mode)            |

The bridge routes to the right host adapter (OpenAI SDK / Claude postMessage / FrontMCP direct) automatically. **Never call `window.openai.*` directly** — it works on OpenAI but breaks everywhere else.

## Host considerations

| Host                 | Notes                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Apps SDK**  | Any CDN works. The widget is advertised the same way as for every host — `tools/list` emits `_meta.ui.resourceUri` pointing at `ui://widget/{toolName}.html` (the MCP Apps `ui/*` namespace); there is no `openai/outputTemplate` key. |
| **Claude (MCP-UI)**  | Widget iframe blocks all external script execution. Use `resourceMode: 'inline'` (auto-detected when you leave it unset) so React bundles in. CSP must be on the resource — framework handles it via `ui.csp` (#455 fix).              |
| **MCP Inspector**    | Useful for local development. Static mode works fine.                                                                                                                                                                                  |
| **Gemini / unknown** | `ui` is ignored — JSON output is returned.                                                                                                                                                                                             |

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
- **Runtime auto-resize** — when `autoResize !== false` and `ResizeObserver` is available, the bridge observes `#root` and reports the measured height to the host (debounced via `requestAnimationFrame`), also firing a `widget:resize` event you can listen for. Call `window.FrontMcpBridge.setSize({ height, width, aspectRatio })` to report manually.

Per-host behavior:

- **Claude / static widgets** — the host measures the iframe DOM height itself, so auto-resize is effectively CSS-only (the `setSize` report is a no-op). The injected CSS is what makes a fixed-tall widget (media players, canvases) open without clipping.
- **OpenAI ChatGPT** — auto-resize forwards to the Apps SDK sizing API when one is exposed; otherwise the SDK's own DOM measurement applies.
- **ext-apps hosts** — the measured size is reported via a `ui/setSize` request (parallels `ui/setDisplayMode`).
- **Gemini / generic / unknown** — `setSize` is a no-op; only the static CSS applies.

`displayMode: 'fullscreen'` remains a separate, best-effort hint a host may ignore.

## Current limitations

- **Don't push large payloads through the widget.** Claude's sandbox CSP blocks external `connect-src`, so an inline widget can't reliably lazy-load multi-MB data, and a single MCP message is a poor carrier for it either. For large or streamed data, return a `resource_link` (see [`output-schema.md`](./output-schema.md)) and let the host fetch the resource — don't embed it in the widget or the tool result.

## Examples

- [`22-tool-with-ui-html-template`](../examples/22-tool-with-ui-html-template.md) — inline function template
- [`23-tool-with-ui-filesource-tsx`](../examples/23-tool-with-ui-filesource-tsx.md) — `.tsx` widget, host-detect
- [`24-tool-with-ui-csp-and-bridge`](../examples/24-tool-with-ui-csp-and-bridge.md) — CSP + `widgetAccessible` + bridge

## Related rules

- [`rules/widget-paths-anchor-with-import-meta-url.md`](../rules/widget-paths-anchor-with-import-meta-url.md)
- [`rules/widget-resource-mode-host-detect.md`](../rules/widget-resource-mode-host-detect.md)
