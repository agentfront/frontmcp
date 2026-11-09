/**
 * Standalone UI Configuration Types
 *
 * SDK-independent types for configuring UI templates.
 * These types can be used by external consumers (like AgentLink)
 * without requiring @frontmcp/sdk as a dependency.
 *
 * @packageDocumentation
 */

import type { FileSource } from '../component/types';
import type { CDNDependency } from '../resolver/types';
import type { CustomShellSource } from '../shell/custom-shell-types';
import type { TrustedHtml } from '../shell/trusted-html';

/**
 * Configuration options for bundling file-based components.
 */
export interface FileBundleOptions {
  /** Minify the bundled output */
  minify?: boolean;
  /** Generate source maps for debugging */
  sourceMaps?: boolean;
  /** Target JavaScript version */
  target?: 'es2018' | 'es2019' | 'es2020' | 'es2021' | 'es2022' | 'esnext';
  /** Enable tree shaking */
  treeShake?: boolean;
  /** JSX factory function */
  jsxFactory?: string;
  /** JSX fragment factory */
  jsxFragment?: string;
  /** JSX import source for automatic runtime */
  jsxImportSource?: string;
}

// ============================================
// Content Security Policy
// ============================================

/**
 * Content Security Policy for UI templates rendered in sandboxed iframes.
 * Based on OpenAI Apps SDK and MCP Apps (SEP-1865) specifications.
 *
 * **Where this is emitted (issue #455 fix):** FrontMCP attaches this
 * configuration to the **resource** content item returned by
 * `resources/read` for `ui://widget/{toolName}.html`, as both
 * `_meta.ui.csp` (nested) and `_meta['ui/csp']` (slash) with the MCP Apps
 * `connectDomains` / `resourceDomains` keys (the snake_case keys sent up to
 * 1.9.2 stay alongside), and as `_meta['openai/widgetCSP']` with the OpenAI
 * Apps SDK's `connect_domains` / `resource_domains`. MCP Apps hosts (notably
 * Claude) only honor CSP declared on the resource — declarations on the
 * tool's `_meta.ui.csp` are ignored.
 */
export interface UIContentSecurityPolicy {
  /**
   * Origins allowed for fetch/XHR/WebSocket connections.
   * Maps to CSP `connect-src` directive.
   * @example ['https://api.example.com', 'https://*.myservice.com']
   */
  connectDomains?: string[];

  /**
   * Origins allowed for images, scripts, fonts, and styles.
   * Maps to CSP `img-src`, `script-src`, `style-src`, `font-src` directives.
   * @example ['https://cdn.example.com']
   */
  resourceDomains?: string[];
}

/**
 * Sanitization of widget markup (`ui.contentSecurity`).
 *
 * Without `contentSecurity`, template markup reaches the page as written: a `<script>`, an
 * `onclick` or a `javascript:` link in markup a template builds (`ctx.helpers.html`, `trustedHtml`,
 * an HTML string) is kept, which is what widgets with inline scripts rely on. Values interpolated
 * into `` html`…` `` are escaped either way, and so are plain string results unless
 * `escapeStringResults: false`.
 *
 * With `contentSecurity` set, even to `{}`, the markup FrontMCP builds on the server from the
 * template is sanitized before it goes into the page: `<script>` elements, `on*` handler
 * attributes, `srcdoc`, `<object>` / `<embed>` / `<applet>`, `<base>` and `<meta>` are removed, and so
 * is every URL attribute (`href`, `src`, `action`, `formaction`, `xlink:href`, `srcset`, …) whose
 * scheme isn't `http:`, `https:` or `mailto:`. Relative URLs stay, and so do raster
 * `data:image/…` URLs in `<img src>`. Comments are dropped. The flags below relax it.
 *
 * It applies to HTML, Markdown and MDX strings, to a template function's result, and to a
 * component rendered on the server with `uiType: 'react'`. The page FrontMCP builds around the
 * markup (the bridge, the call's data) is not touched, and a `{ file }` widget, which renders in
 * the page, can't take it: the server refuses to start such a tool.
 *
 * Both OpenAI and Claude render widgets in sandboxed iframes, so script in a widget is contained,
 * but it can still read the widget's data, call tools the widget may call and show a fake UI.
 * Sanitize when the markup carries values you don't control and you'd rather not rely on escaping
 * every one of them.
 */
export interface UIContentSecurity {
  /**
   * Keep URL attributes with any scheme, including `javascript:`, `data:` and `vbscript:`.
   *
   * @default false
   */
  allowUnsafeLinks?: boolean;

  /**
   * Keep `<script>` elements, `on*` event handler attributes, `srcdoc` and `<object>` / `<embed>` /
   * `<applet>`. Hosts may still block a script through the widget's Content-Security-Policy.
   *
   * @default false
   */
  allowInlineScripts?: boolean;

  /**
   * Skip sanitization: the markup is used as written, as if `contentSecurity` were unset. Only for
   * markup you fully trust.
   *
   * @default false
   */
  bypassSanitization?: boolean;
}

// ============================================
// Template Context & Helpers
// ============================================

/**
 * Helper functions available in template context.
 */
export interface TemplateHelpers {
  /**
   * Escape HTML special characters to prevent XSS.
   * Handles null/undefined by returning empty string.
   * Non-string values are converted to string before escaping.
   */
  escapeHtml: (str: unknown) => string;

  /**
   * Format a date for display.
   * @param date - Date object or ISO string
   * @param format - Optional format (default: localized date)
   */
  formatDate: (date: Date | string, format?: string) => string;

  /**
   * Format a number as currency.
   * @param amount - The numeric amount
   * @param currency - ISO 4217 currency code (default: 'USD')
   */
  formatCurrency: (amount: number, currency?: string) => string;

  /**
   * Generate a unique ID for DOM elements.
   * @param prefix - Optional prefix for the ID
   */
  uniqueId: (prefix?: string) => string;

  /**
   * Safely embed JSON data in HTML (escapes script-breaking characters).
   */
  jsonEmbed: (data: unknown) => string;

  /**
   * Tagged template that builds trusted markup. The literal parts stay HTML; each interpolated
   * value is HTML-escaped unless it is itself `TrustedHtml`. Arrays are joined without a
   * separator and `null` / `undefined` / `false` render nothing. Don't pre-escape values.
   *
   * @example ctx.helpers.html`<h2>${ctx.output.title}</h2>`
   */
  html: (strings: TemplateStringsArray, ...values: unknown[]) => TrustedHtml;

  /**
   * Mark markup you produced or sanitized yourself as trusted, so it renders as HTML although plain
   * string results are escaped. Never pass raw tool output or user input.
   */
  trustedHtml: (markup: string) => TrustedHtml;
}

/**
 * Context passed to template builder functions.
 * Contains all data needed to render a tool's UI template.
 */
export interface TemplateContext<In = unknown, Out = unknown> {
  /**
   * The input arguments passed to the tool.
   */
  input: In;

  /**
   * The raw output returned by the tool's execute method.
   */
  output: Out;

  /**
   * The structured content parsed from the output (if outputSchema was provided).
   * This is the JSON-serializable form suitable for widget consumption.
   */
  structuredContent?: unknown;

  /**
   * Helper functions for template rendering.
   */
  helpers: TemplateHelpers;
}

/**
 * Template builder function type.
 * Receives context with input/output and returns markup: `TrustedHtml` from
 * `ctx.helpers.html` / `ctx.helpers.trustedHtml`, or a string (see `escapeStringResults`).
 */
export type TemplateBuilderFn<In = unknown, Out = unknown> = (ctx: TemplateContext<In, Out>) => string | TrustedHtml;

// ============================================
// Widget Serving Mode
// ============================================

/**
 * Widget serving mode determines how the widget HTML is delivered to the client.
 *
 * - `'auto'` (default): Automatically select mode based on client capabilities.
 *   For ext-apps and Claude: uses 'inline'. For OpenAI: uses 'static', so no result carries
 *   the page: the OpenAI Apps SDK renders the widget from its `ui://` resource.
 *   For unsupported clients (e.g., Gemini): skips UI entirely (returns JSON only).
 *
 * - `'inline'`: HTML embedded directly in tool response `_meta['ui/html']`.
 *   Works on all platforms including network-blocked ones, **provided the HTML
 *   itself is fully self-contained** (no external `<script src>` / module
 *   import maps). See the Claude target note on {@link UITemplateConfig.resourceMode}.
 *
 * - `'static'`: Pre-compiled at startup, resolved via `tools/list` (ui:// resource URI).
 *   Widget is fetched via MCP `resources/read`.
 *
 * - `'hybrid'`: Shell (React runtime + bridge) pre-compiled at startup.
 *   Component code transpiled per-request and delivered in `_meta['ui/component']`.
 *
 * - `'direct-url'`: Compiled at startup, as with `'static'`, and served on a route of the server
 *   (`directPath`). The `ui://` resource is a small page that frames that URL and relays the host's
 *   bridge messages. Results carry no page.
 *
 * - `'custom-url'`: The page at `customWidgetUrl` (a CDN, a separate deployment) is the widget; the
 *   `ui://` resource frames it, as for `'direct-url'`. FrontMCP doesn't render `template` for it.
 *   Results carry no page.
 *
 * ## Claude target caveat (issue #447)
 *
 * Claude Desktop / claude.ai render widgets in a sandboxed iframe whose CSP
 * blocks **all** external script execution — including esm.sh — regardless of
 * what's set on the tool's `_meta.ui.csp` (Claude only honors CSP declared
 * on the UI resource; see issue #455). React `FileSource` templates and any
 * widget that loads runtime modules from a CDN will silently hang on the
 * "Loading widget…" placeholder in Claude. Only fully self-contained HTML
 * (all JS inline, no import map, no `<script src="https://…">`) renders
 * reliably in Claude today.
 */
export type WidgetServingMode =
  | 'auto' // Automatically select based on client capabilities (default)
  | 'inline' // HTML embedded directly in tool response _meta
  | 'static' // Pre-compiled at startup, resolved via tools/list (ui:// resource URI)
  | 'hybrid' // Shell (React + renderer) cached, component + data in response
  | 'direct-url' // Compiled at startup, served on a server route that the ui:// resource frames
  | 'custom-url'; // The page at customWidgetUrl, which the ui:// resource frames

// ============================================
// Display Mode
// ============================================

/**
 * Widget display mode preference.
 */
export type WidgetDisplayMode = 'inline' | 'fullscreen' | 'pip';

/**
 * A widget sizing value.
 *
 * - `number` — interpreted as CSS pixels (e.g. `420` → `420px`).
 * - `string` — any valid CSS length (e.g. `'50vh'`, `'24rem'`, `'480px'`).
 */
export type WidgetSizeValue = number | string;

// ============================================
// UI Template Configuration
// ============================================
/**
 * UI template configuration for tools.
 * Enables rendering interactive widgets for tool responses in supported hosts
 * (OpenAI Apps SDK, Claude/MCP-UI, etc.).
 *
 * This is a standalone type that doesn't depend on @frontmcp/sdk.
 * Use this type in external systems (like AgentLink) that consume @frontmcp/ui.
 *
 * @example
 * ```typescript
 * const uiConfig: UITemplateConfig = {
 *   template: (ctx) => `
 *     <div class="p-4">
 *       <h2>${ctx.helpers.escapeHtml(ctx.input.location)}</h2>
 *       <p>${ctx.output.temperature}°F</p>
 *     </div>
 *   `,
 *   csp: { connectDomains: ['https://api.weather.com'] },
 *   widgetAccessible: true,
 *   widgetDescription: 'Displays current weather conditions',
 * };
 * ```
 */
export interface UITemplateConfig<In = unknown, Out = unknown> {
  /**
   * Template for rendering tool UI.
   *
   * Supports multiple formats (auto-detected by renderer):
   * - Template builder function: `(ctx) => string` - receives input/output/helpers, returns HTML
   * - Static HTML/MDX string: `"<div>...</div>"` or `"# Title\n<Card />"`
   * - React component: `MyWidget` - rendered on the server with `uiType: 'react'`, with props output/input/loading
   * - FileSource object: `{ file: './my-widget.tsx' }` - transpiled client-side via esm.sh CDN
   *
   * Not rendered for `servingMode: 'custom-url'`, whose page is at `customWidgetUrl`.
   */

  template: TemplateBuilderFn<In, Out> | string | ((props: any) => any) | FileSource;

  /**
   * Content Security Policy for the sandboxed widget.
   * Controls which external resources the widget can access.
   */
  csp?: UIContentSecurityPolicy;

  /**
   * Sanitize the markup FrontMCP builds on the server from the template. Unset (the default), it is
   * used as written; set, even to `{}`, scripts, event handlers and unsafe links are removed unless
   * the flags allow them. See {@link UIContentSecurity}.
   *
   * @example
   * ```typescript
   * // Render the HTML a tool returns, without its scripts, handlers or unsafe links
   * ui: {
   *   template: (ctx) => ctx.output.summaryHtml,
   *   escapeStringResults: false,
   *   contentSecurity: {},
   * }
   * ```
   */
  contentSecurity?: UIContentSecurity;

  /**
   * HTML-escape a plain string returned by a template function.
   *
   * - unset (the default since 1.9.2): plain strings are escaped and shown as text, and a one-time notice per
   *   tool is logged when one looked like markup; markup built with `ctx.helpers.html` or wrapped
   *   with `ctx.helpers.trustedHtml` still renders as HTML.
   * - `true`: the same, without the notice.
   * - `false`: strings that look like HTML render as markup (the behaviour before 1.9.2).
   *
   * Overrides the server-wide `@FrontMcp({ ui: { escapeStringResults } })` default.
   * Static string templates (`template: '<div>…</div>'`) are author markup and never escaped.
   */
  escapeStringResults?: boolean;

  /**
   * Whether the widget may call tools itself. Sent in `tools/list` as
   * `_meta['openai/widgetAccessible']`, which the OpenAI Apps SDK requires for
   * `window.openai.callTool()`; MCP Apps hosts let widgets call tools by default.
   */
  widgetAccessible?: boolean;

  /**
   * Preferred display mode for the widget, which the page asks the host for once its
   * bridge connects (`ui/request-display-mode`, or `window.openai.requestDisplayMode()`).
   * - 'inline': Rendered inline in the conversation (default; nothing is asked)
   * - 'fullscreen': Request fullscreen display
   * - 'pip': Picture-in-picture mode
   *
   * Note: Host may not support all modes; this is a preference hint.
   */
  displayMode?: WidgetDisplayMode;

  /**
   * Preferred initial height for the widget iframe.
   *
   * Applied as the starting height on the shell document (`html`/`body`/`#root`)
   * and exposed to the host via `_meta['ui/preferredHeight']`. A `number` is
   * treated as CSS pixels; a `string` is any valid CSS length (`'50vh'`,
   * `'24rem'`). When `autoResize` is enabled the runtime grows/shrinks from
   * this baseline to fit content.
   */
  preferredHeight?: WidgetSizeValue;

  /**
   * Minimum height for the widget. Applied as `min-height` CSS and exposed via
   * `_meta['ui/minHeight']`. Auto-resize never reports a height below this.
   */
  minHeight?: WidgetSizeValue;

  /**
   * Maximum height for the widget. Applied as `max-height` CSS and exposed via
   * `_meta['ui/maxHeight']`. Auto-resize never reports a height above this.
   */
  maxHeight?: WidgetSizeValue;

  /**
   * CSS `aspect-ratio` for the widget (e.g. `'16 / 9'` or `1.5`). Applied as
   * `aspect-ratio` CSS on the shell and exposed via `_meta['ui/aspectRatio']`.
   * When set, hosts that honor it size the widget by ratio instead of by
   * measured content height.
   */
  aspectRatio?: string | number;

  /**
   * Whether the widget should auto-report its height to the host as it changes
   * (via a debounced `ResizeObserver` on `<html>`, `<body>` and `#root`). The
   * whole document is measured, margins included; the first report is sent once
   * the host handshake completes.
   *
   * Only takes effect when the widget configures sizing — i.e. at least one
   * sizing field (`preferredHeight` / `minHeight` / `maxHeight` / `aspectRatio` /
   * `autoResize`) is set, which is what causes the runtime to be injected. A
   * widget with no sizing config does not auto-resize at all. When sizing is
   * configured, auto-resize is on unless you set this to `false`.
   *
   * - Claude / static widgets: the host measures DOM height itself, so this is
   *   a CSS-only no-op.
   * - OpenAI: forwarded through the Apps SDK sizing API.
   * - ext-apps hosts: reported with the standard `ui/notifications/size-changed` notification.
   *
   * @default true (when the widget configures sizing)
   */
  autoResize?: boolean;

  /**
   * What the widget shows, for the model. Sent on the widget resource as
   * `_meta['openai/widgetDescription']` (OpenAI Apps SDK).
   */
  widgetDescription?: string;

  /**
   * Status messages shown during tool invocation.
   * Exposed via `ui/toolInvocation/invoking` and `ui/toolInvocation/invoked` meta keys.
   *
   * @example
   * ```typescript
   * invocationStatus: {
   *   invoking: 'Fetching weather data...',
   *   invoked: 'Weather data loaded'
   * }
   * ```
   */
  invocationStatus?: {
    /** Status text shown while tool is executing */
    invoking?: string;
    /** Status text shown after tool execution completes */
    invoked?: string;
  };

  /**
   * How the widget HTML should be served to the client.
   *
   * - `'auto'` (default): Automatically select mode based on client capabilities.
   *   For ext-apps and Claude clients: uses `'inline'` with `_meta`.
   *   For OpenAI clients: uses `'static'`, so no result carries the page, not even the one a widget's
   *   own `window.openai.callTool()` gets: the OpenAI Apps SDK renders the widget from its `ui://` resource.
   *   For unsupported clients (Gemini, unknown): skips UI (returns JSON only).
   *
   * - `'inline'`: HTML embedded directly in tool response `_meta['ui/html']`.
   *   Best for small widgets, works on all platforms including network-blocked ones.
   *
   * - `'static'`: Widget pre-compiled at server startup, registered as MCP resource with `ui://` URI.
   *   Client fetches via `resources/read`. Good for OpenAI's template system.
   *   Widget is resolved during `tools/list`, not dependent on tool call.
   *
   * - `'hybrid'`: Shell (React runtime + bridge) pre-compiled at startup.
   *   Component code transpiled per-request and delivered in `_meta['ui/component']`.
   *
   * - `'direct-url'`: Compiled at startup, as with `'static'`, and served from the server's own
   *   HTTP route (`directPath`). The `ui://` resource is a small page that frames that URL, so the
   *   widget runs on the server's origin, and relays the host's bridge messages to it. The resource
   *   declares the URL's origin as a frame: `_meta.ui.csp.frameDomains` (MCP Apps) and
   *   `_meta['openai/widgetCSP'].frame_domains` (OpenAI Apps SDK). Results carry no page; the host
   *   sends each call's data to the widget.
   *
   * - `'custom-url'`: The page at `customWidgetUrl`, such as a CDN's, is the widget. The `ui://`
   *   resource frames it and declares its origin as a frame, as for `'direct-url'`. FrontMCP doesn't
   *   render `template` for this mode. Results carry no page.
   *
   * When unset, the FrontMCP SDK uses the app's `@App({ ui: { servingMode } })` default, else the
   * server's `@FrontMcp({ ui: { servingMode } })`, else `'auto'`.
   *
   * @default 'auto'
   */
  servingMode?: WidgetServingMode;

  /**
   * The URL of the widget page when `servingMode: 'custom-url'`: an `https://` URL (or `http://` on
   * localhost), such as a CDN's. The `ui://` resource frames it, declares its origin as a frame
   * (`_meta.ui.csp.frameDomains`, `_meta['openai/widgetCSP'].frame_domains`) and relays the host's
   * bridge messages to it.
   *
   * The page is yours: FrontMCP doesn't render `template` for it, and it must answer the host over
   * the MCP Apps bridge (JSON-RPC over `postMessage` to its parent): a page built with `buildShell()`
   * from `@frontmcp/uipack/shell` has FrontMCP's bridge, and `@modelcontextprotocol/ext-apps` works
   * too. It must allow framing (no `X-Frame-Options: DENY`).
   *
   * The URL is used as written: FrontMCP adds no token or call data to it, and the page gets each
   * call's result from the host. Startup refuses a URL with a `{…}` placeholder or credentials, a
   * `'custom-url'` widget without this option, and this option on a widget not served `'custom-url'`.
   *
   * @example
   * ```typescript
   * ui: { template: '', servingMode: 'custom-url', customWidgetUrl: 'https://cdn.example.com/widgets/weather.html' }
   * ```
   */
  customWidgetUrl?: string;

  /**
   * The route a `servingMode: 'direct-url'` widget is served on, from the server's root. Default:
   * `/widgets/` and the tool name (characters other than letters, digits, `.`, `_`, `~` and `-`
   * become `-`).
   *
   * The route answers `GET` without auth, in every auth mode, because a host loads it in a frame,
   * which sends no credentials. It serves the page compiled at startup, which holds no call's data.
   * The URL the `ui://` resource frames starts with `FRONTMCP_PUBLIC_URL` when set, else with the
   * scheme and host the `resources/read` request came to. Startup refuses a path that collides with
   * another route of the server or another widget, and a `directPath` on a widget not served
   * `'direct-url'`.
   *
   * @example
   * ```typescript
   * ui: { template: WeatherWidget, servingMode: 'direct-url', directPath: '/widgets/weather' }
   * // ui://widget/get_weather.html frames https://mcp.example.com/widgets/weather
   * ```
   */
  directPath?: string;

  /**
   * React components for an MDX template. With `mdxComponents` set, a string template is MDX: it is
   * compiled once with `@mdx-js/mdx` and rendered to HTML on the server with React for each render,
   * with these components for the tags it names (and for HTML elements it overrides, such as `h1`).
   * Its expressions read the call's data as `input`, `output` and `helpers`; the data is rendered as
   * escaped text, never compiled. The page carries the rendered HTML, not React, so event handlers
   * in the template don't run in the page.
   *
   * Needs `@mdx-js/mdx`, `react` and `react-dom` installed (and `remark-gfm` for
   * `runtimeOptions.markdown.gfm`); `runtimeOptions.markdown.highlightTheme` highlights its fenced
   * code. The template compiles at startup, so a syntax error or a missing package fails it. Only a
   * string template can be MDX: a template function's result carries the call's data, and compiling
   * it would run that data as code, so `mdxComponents` on a function fails startup.
   *
   * @example
   * ```typescript
   * ui: {
   *   template: `# {output.title}\n\n<Alert type="info">{output.items.length} items</Alert>`,
   *   mdxComponents: { Alert },
   * }
   * ```
   */
  mdxComponents?: Record<string, any>;

  // ============================================
  // MCP Apps (ext-apps) Specific Options
  // ============================================

  /**
   * MCP Apps: Explicit resource URI for the UI template.
   * If not specified, auto-generated as `ui://widget/{toolName}.html`
   *
   * Use this when you need a specific URI pattern for your widget,
   * such as when integrating with existing resource systems.
   *
   * @example 'ui://my-app/dashboard.html'
   * @example 'ui://weather-service/forecast.html'
   */
  resourceUri?: string;

  /**
   * MCP Apps: Widget capabilities for ext-apps initialization.
   *
   * These capabilities are communicated to the host during tool discovery,
   * allowing the host to enable or configure specific features.
   */
  widgetCapabilities?: {
    /** Widget can emit tool list changes (dynamic tool registration) */
    toolListChanged?: boolean;
    /** Widget can handle partial tool input streaming */
    supportsPartialInput?: boolean;
  };

  /**
   * Whether to show a border around the UI widget.
   * Sent on the widget resource as `_meta.ui.prefersBorder` (MCP Apps) and
   * `_meta['openai/widgetPrefersBorder']` (OpenAI Apps SDK).
   *
   * When true, hosts should render a visible border around the sandbox iframe.
   * Useful for visual clarity when the widget content doesn't have its own borders.
   *
   * Default: undefined (host decides)
   */
  prefersBorder?: boolean;

  /**
   * Dedicated sandbox domain for the widget.
   * Sent on the widget resource as `_meta.ui.domain` (MCP Apps) and
   * `_meta['openai/widgetDomain']` (OpenAI Apps SDK).
   *
   * When specified, the host should load the widget in an iframe with this
   * domain as the origin, providing additional isolation.
   *
   * @example 'sandbox.example.com'
   */
  sandboxDomain?: string;

  // ============================================
  // Rendering Options
  // ============================================

  /**
   * Render a React widget on the server and hydrate it in the page.
   *
   * Applies to a `{ file }` `.tsx` / `.jsx` widget. FrontMCP bundles the widget for the server too,
   * renders it there with the call's data (the props the page's mount gives it: `output`, `input`,
   * `loading`) inside `McpBridgeProvider`, and puts that HTML in the page's `#root`; the page's mount
   * then calls `hydrateRoot` with the same props instead of rendering into an empty root. The widget
   * shows its content before its script runs, and stays interactive.
   *
   * Hydration expects the page to render what the server did: a widget whose first render reads
   * `window`, the time or random values, or a host-specific hook value, may not match, and React then
   * renders it again in the page (logging a recoverable error). A widget compiled at startup
   * (`servingMode: 'static'`) is rendered with no data, in its `loading` state.
   *
   * A component reference (`template: MyWidget`) has no source file to bundle for the page, so it
   * can't be hydrated: render it on the server only with `uiType: 'react'`, or use `{ file }`. Any
   * other template fails startup with `hydrate: true`.
   *
   * @default false
   */
  hydrate?: boolean;

  // ============================================
  // Runtime/Build Configuration (from ui-runtime.ts)
  // ============================================

  /**
   * The renderer, instead of the one detected from the template.
   *
   * - `'auto'` (default): detected. A string with both `<` and `>` is HTML, any other string is
   *   Markdown (MDX with `mdxComponents`), a function is an HTML builder unless it is a React
   *   component, and `{ file: '….tsx' }` is a React widget.
   * - `'html'`: a string is used as written, even without `<` and `>`, and a function is called as
   *   an HTML builder, even with a capitalized name.
   * - `'markdown'`: a string is converted from Markdown even with `<` and `>` (raw HTML is escaped),
   *   and so is a template function's string result.
   * - `'mdx'`: a string is rendered as MDX on the server, with `mdxComponents` if set.
   * - `'react'`: a component reference (function, class, `memo` / `forwardRef`) is rendered to
   *   static HTML on the server with React, with the widget props (`output`, `input`, `loading`);
   *   it can't be bundled for the page, so its handlers don't run there. A `{ file }` `.tsx` /
   *   `.jsx` widget is bundled for the page as with `'auto'`.
   *
   * A template the renderer can't take fails startup, such as `'react'` on a string or `'mdx'` on a
   * function. `'react'`, `'mdx'` and `hydrate` load `react` and `react-dom` from the server's project.
   *
   * @default 'auto'
   */
  uiType?: 'html' | 'react' | 'mdx' | 'markdown' | 'auto';

  /**
   * Bundling mode.
   *
   * - `'static'`: Pre-compile widget shell, inject data at runtime (default)
   * - `'dynamic'`: Generate fresh HTML per tool invocation
   *
   * @deprecated Has no effect: `servingMode` decides it (`'static'` compiles the page at startup,
   * `'inline'` renders it for each call). Startup logs a warning when it is set.
   */
  bundlingMode?: 'static' | 'dynamic';

  /**
   * Resource loading mode for renderer runtime scripts (React, MDX, Handlebars).
   *
   * - `'cdn'`: Load runtime scripts from CDN URLs (lightweight). Works in OpenAI
   *   Apps SDK, ChatGPT, Cursor, MCP Inspector, and other CDN-permissive hosts.
   *
   * - `'inline'`: Embed everything in the HTML. For `FileSource` (`.tsx`/`.jsx`)
   *   templates, React and ReactDOM are bundled into the widget's
   *   `<script type="module">` (no esm.sh import map). The output is a fully
   *   self-contained widget that runs in hosts which block external script
   *   execution — including Claude Desktop / claude.ai (fix shipped for #454).
   *
   * @default `'cdn'` for most platforms. When left unset, FrontMCP host-detects
   *   the right default: `platformType === 'claude'` auto-switches to
   *   `'inline'` so widgets actually render under Claude's CSP (#456). Set
   *   the value explicitly to opt out of the detection.
   *
   *   **Auto-detection only applies to per-call rendering modes (inline /
   *   hybrid / lean).** Static-mode widgets compile at server startup, before
   *   any client connects, so the platform isn't known. If your tool uses
   *   `servingMode: 'static'` and targets Claude, set `resourceMode: 'inline'`
   *   explicitly.
   */
  resourceMode?: 'cdn' | 'inline';

  /**
   * Runtime options for specific renderers.
   */
  runtimeOptions?: {
    /** Same as {@link UITemplateConfig.hydrate}, which wins when both are set. */
    hydrate?: boolean;
    /**
     * How a Markdown template (a string template without both `<` and `>`) is converted to HTML.
     * Unset, the converter writes headings, paragraphs, lists, fenced code, emphasis, inline code
     * and links. Setting `gfm` or `highlightTheme` on a template that isn't Markdown fails startup.
     *
     * @example
     * ```typescript
     * ui: {
     *   template: '| Region | Sales |\n|---|---:|\n| EU | 12 |\n\n```ts\nconst total = 12;\n```',
     *   runtimeOptions: { markdown: { gfm: true, highlightTheme: 'github' } },
     * }
     * ```
     */
    markdown?: {
      /**
       * GitHub-flavored Markdown: tables (with `:---:` alignment), task list items (`- [x]`),
       * `~~strikethrough~~`, and links for bare `https://` and `www.` URLs. Raw HTML stays escaped.
       */
      gfm?: boolean;
      /**
       * Highlight fenced code that names its language (```` ```ts ````) on the server with highlight.js,
       * an optional peer to install, and put this theme's stylesheet in the page: the name of a
       * stylesheet in `highlight.js/styles`, such as `'github'`, `'github-dark'` or
       * `'base16/dracula'`. A missing highlight.js or theme fails startup.
       */
      highlightTheme?: string;
    };
  };

  // ============================================
  // Dual-Payload Options (Claude Artifacts)
  // ============================================

  /**
   * Prefix text shown before HTML in dual-payload responses (Claude).
   *
   * @deprecated Has no effect: FrontMCP sends no dual HTML payload, to Claude or any other client.
   * Startup logs a warning when it is set.
   */
  htmlResponsePrefix?: string;

  // ============================================
  // File-Based Template Options (NEW)
  // ============================================

  /**
   * Packages to load from CDN instead of bundling.
   *
   * When `template` is a file path (e.g., `'./chart-widget.tsx'`), imports
   * of these packages will be excluded from the bundle and loaded at runtime
   * via CDN import maps.
   *
   * Package names should match npm package names. The CDN URL is resolved
   * from the built-in CDN registry or from explicit `dependencies` overrides.
   *
   * **Platform considerations (issue #447):**
   * - **Claude Desktop / claude.ai**: the widget iframe blocks all external
   *   script execution regardless of CSP, including `cdnjs.cloudflare.com`.
   *   Even pinning `dependencies` to cdnjs URLs is not enough today —
   *   `.tsx` `FileSource` widgets that rely on a CDN import map for React
   *   itself hang on the "Loading widget…" placeholder (see #454 / #455).
   *   Use a fully self-contained `uiType: 'html'` function template for
   *   Claude until those land.
   * - **OpenAI Apps SDK / ChatGPT / Cursor / MCP Inspector**: any CDN works;
   *   esm.sh is the default. Pinning to `cdnjs.cloudflare.com` via
   *   `dependencies` overrides is recommended only when targeting hosts
   *   with stricter CSP than esm.sh allows.
   *
   * @example
   * ```typescript
   * // Auto-resolved from CDN registry
   * ui: {
   *   template: './chart-widget.tsx',
   *   externals: ['chart.js', 'react-chartjs-2'],
   * }
   *
   * // With explicit override
   * ui: {
   *   template: './chart-widget.tsx',
   *   externals: ['chart.js'],
   *   dependencies: {
   *     'chart.js': {
   *       url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
   *       integrity: 'sha512-...',
   *       global: 'Chart',
   *     },
   *   },
   * }
   * ```
   */
  externals?: string[];

  /**
   * Explicit CDN dependency overrides for external packages.
   *
   * Use this to specify custom CDN URLs or override the default CDN registry
   * entries for packages listed in `externals`.
   *
   * Keys are npm package names. Values specify the CDN URL, integrity hash,
   * and other loading options.
   *
   * @example
   * ```typescript
   * ui: {
   *   template: './dashboard.tsx',
   *   externals: ['d3', 'lodash'],
   *   dependencies: {
   *     'd3': {
   *       url: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js',
   *       integrity: 'sha512-...',
   *       global: 'd3',
   *     },
   *     'lodash': {
   *       url: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
   *       global: '_',
   *     },
   *   },
   * }
   * ```
   */
  dependencies?: Record<string, CDNDependency>;

  /**
   * Bundle options for file-based templates.
   *
   * Controls how the file-based template is compiled and bundled.
   * These options are only used when `template` is a file path.
   *
   * @example
   * ```typescript
   * // Development mode
   * ui: {
   *   template: './debug-widget.tsx',
   *   bundleOptions: {
   *     minify: false,
   *     sourceMaps: true,
   *     target: 'esnext',
   *   },
   * }
   *
   * // Production mode (defaults)
   * ui: {
   *   template: './widget.tsx',
   *   bundleOptions: {
   *     minify: true,
   *     treeShake: true,
   *     target: 'es2020',
   *   },
   * }
   * ```
   */
  fileBundleOptions?: FileBundleOptions;

  /**
   * Custom HTML shell template with placeholders.
   *
   * Instead of the default HTML document, use a custom template
   * containing `{{CONTENT}}` (required) and optional `{{CSP}}`,
   * `{{DATA}}`, `{{BRIDGE}}`, `{{TITLE}}` placeholders.
   *
   * Source: inline string, URL, or npm package.
   *
   * @example
   * ```typescript
   * // Inline
   * customShell: { inline: '<html><head>{{CSP}}{{DATA}}</head><body>{{CONTENT}}</body></html>' }
   *
   * // URL
   * customShell: { url: 'https://cdn.example.com/my-shell.html' }
   *
   * // NPM
   * customShell: { npm: '@acme/mcp-shell-template' }
   * ```
   */
  customShell?: CustomShellSource;
}

/**
 * Type alias for backwards compatibility.
 * Prefer using UITemplateConfig directly.
 */
export type UITemplate<In = unknown, Out = unknown> = UITemplateConfig<In, Out>;
