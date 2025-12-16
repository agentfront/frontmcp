/**
 * Standalone UI Configuration Types
 *
 * SDK-independent types for configuring UI templates.
 * These types can be used by external consumers (like AgentLink)
 * without requiring @frontmcp/sdk as a dependency.
 *
 * @packageDocumentation
 */

// ============================================
// Content Security Policy
// ============================================

/**
 * Content Security Policy for UI templates rendered in sandboxed iframes.
 * Based on OpenAI Apps SDK and MCP Apps (SEP-1865) specifications.
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

// ============================================
// Template Context & Helpers
// ============================================

/**
 * Helper functions available in template context.
 */
export interface TemplateHelpers {
  /**
   * Escape HTML special characters to prevent XSS.
   */
  escapeHtml: (str: string) => string;

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
 * Receives context with input/output and returns HTML string.
 */
export type TemplateBuilderFn<In = unknown, Out = unknown> = (ctx: TemplateContext<In, Out>) => string;

// ============================================
// Widget Serving Mode
// ============================================

/**
 * Widget serving mode determines how the widget HTML is delivered to the client.
 *
 * - `'auto'` (default): Automatically select mode based on client capabilities.
 *   For OpenAI/ext-apps: uses 'inline'. For Claude: uses 'inline' with dual-payload.
 *   For unsupported clients (e.g., Gemini): skips UI entirely (returns JSON only).
 *
 * - `'inline'`: HTML embedded directly in tool response `_meta['ui/html']`.
 *   Works on all platforms including network-blocked ones.
 *
 * - `'static'`: Pre-compiled at startup, resolved via `tools/list` (ui:// resource URI).
 *   Widget is fetched via MCP `resources/read`.
 *
 * - `'hybrid'`: Shell (React runtime + bridge) pre-compiled at startup.
 *   Component code transpiled per-request and delivered in `_meta['ui/component']`.
 *
 * - `'direct-url'`: HTTP endpoint on MCP server.
 *
 * - `'custom-url'`: Custom URL (CDN or external hosting).
 */
export type WidgetServingMode =
  | 'auto' // Automatically select based on client capabilities (default)
  | 'inline' // HTML embedded directly in tool response _meta
  | 'static' // Pre-compiled at startup, resolved via tools/list (ui:// resource URI)
  | 'hybrid' // Shell (React + renderer) cached, component + data in response
  | 'direct-url' // HTTP endpoint on MCP server
  | 'custom-url'; // Custom URL (CDN or external hosting)

/**
 * @deprecated Use 'static' instead of 'mcp-resource'. Will be removed in v2.0.
 * Alias maintained for backwards compatibility.
 */
export type WidgetServingModeLegacy = 'mcp-resource';

// ============================================
// Display Mode
// ============================================

/**
 * Widget display mode preference.
 */
export type WidgetDisplayMode = 'inline' | 'fullscreen' | 'pip';

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
   * - React component: `MyWidget` - receives props with input/output/helpers
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: TemplateBuilderFn<In, Out> | string | ((props: any) => any);

  /**
   * Content Security Policy for the sandboxed widget.
   * Controls which external resources the widget can access.
   */
  csp?: UIContentSecurityPolicy;

  /**
   * Whether the widget can invoke tools via the MCP bridge.
   * When true, the widget gains access to `window.mcpBridge.callTool()`.
   * Maps to OpenAI's `openai/widgetAccessible` annotation.
   *
   * Default: false
   */
  widgetAccessible?: boolean;

  /**
   * Preferred display mode for the widget.
   * - 'inline': Rendered inline in the conversation (default)
   * - 'fullscreen': Request fullscreen display
   * - 'pip': Picture-in-picture mode
   *
   * Note: Host may not support all modes; this is a preference hint.
   */
  displayMode?: WidgetDisplayMode;

  /**
   * Human-readable description shown to users about what the widget does.
   * Maps to OpenAI's `openai/widgetDescription` annotation.
   */
  widgetDescription?: string;

  /**
   * Status messages shown during tool invocation (OpenAI ChatGPT specific).
   * Maps to OpenAI's `openai/toolInvocation/invoking` and `openai/toolInvocation/invoked`.
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
   *   For OpenAI/ext-apps clients: uses `'inline'` with `_meta`.
   *   For Claude clients: uses `'inline'` with dual-payload format.
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
   * - `'direct-url'`: Served from MCP server's HTTP endpoint.
   *   Avoids third-party cookie issues since widget loads from same domain.
   *
   * - `'custom-url'`: Served from a custom URL (CDN, external hosting).
   *   Requires `customWidgetUrl` to be set.
   *
   * @default 'auto'
   */
  servingMode?: WidgetServingMode;

  /**
   * Custom URL for widget serving when `servingMode: 'custom-url'`.
   * The URL can include `{token}` placeholder which will be replaced with
   * the widget access token.
   *
   * @example
   * ```typescript
   * customWidgetUrl: 'https://cdn.example.com/widgets/weather.html?token={token}'
   * ```
   */
  customWidgetUrl?: string;

  /**
   * Path for direct URL serving when `servingMode: 'direct-url'`.
   * This path is appended to the MCP server's base URL.
   *
   * @example
   * ```typescript
   * directPath: '/widgets/weather'
   * // Results in: https://mcp-server.example.com/widgets/weather?token=...
   * ```
   */
  directPath?: string;

  /**
   * Custom React components available in MDX templates.
   * These components can be used directly in MDX content without importing.
   *
   * @example
   * ```typescript
   * ui: {
   *   template: `# Weather\n<Alert type="info">Data loaded</Alert>`,
   *   mdxComponents: {
   *     Alert: ({ type, children }) => <div className={type}>{children}</div>,
   *     Card: MyCardComponent,
   *   }
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, any>;

  // ============================================
  // MCP Apps (ext-apps) Specific Options
  // ============================================

  /**
   * Whether to show a border around the UI widget.
   * MCP Apps spec: `_meta.ui.prefersBorder`
   *
   * When true, hosts should render a visible border around the sandbox iframe.
   * Useful for visual clarity when the widget content doesn't have its own borders.
   *
   * Default: undefined (host decides)
   */
  prefersBorder?: boolean;

  /**
   * Dedicated sandbox domain for the widget.
   * MCP Apps spec: `_meta.ui.domain`
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
   * Enable client-side React hydration after server-side rendering (SSR).
   *
   * **Default: `false`**
   *
   * When `false` (default):
   * - SSR output is static HTML
   * - No React runtime is loaded on the client
   * - All interactivity is handled by the FrontMCP Bridge IIFE
   * - This prevents React Hydration Error #418 in MCP clients
   *
   * When `true`:
   * - React/ReactDOM CDN scripts are included
   * - Client attempts to hydrate React components
   * - May cause hydration mismatch errors in some MCP clients (Claude, ChatGPT)
   *
   * **Why disabled by default?**
   * MCP clients like Claude and ChatGPT render HTML in sandboxed iframes.
   * React hydration expects the client-rendered HTML to exactly match the
   * server-rendered HTML. Due to timing differences, random data, and
   * different execution contexts, mismatches frequently occur causing
   * React Error #418 ("Hydration failed...").
   *
   * The FrontMCP Bridge IIFE already provides all necessary interactivity
   * (tool calls via `data-tool-call`, state updates, loading states) without
   * requiring React hydration.
   *
   * **Only enable if:**
   * - You need React state management on the client
   * - You're sure your template produces deterministic HTML
   * - You've tested hydration works in your target MCP client
   *
   * @example
   * ```typescript
   * // Disable hydration (default behavior - recommended)
   * ui: {
   *   template: MyReactComponent,
   *   hydrate: false
   * }
   *
   * // Enable hydration (use with caution)
   * ui: {
   *   template: MyStatefulComponent,
   *   hydrate: true
   * }
   * ```
   */
  hydrate?: boolean;

  // ============================================
  // Runtime/Build Configuration (from ui-runtime.ts)
  // ============================================

  /**
   * UI renderer type.
   *
   * - `'html'`: HTML with optional Handlebars
   * - `'react'`: React component (SSR)
   * - `'mdx'`: MDX template
   * - `'markdown'`: Pure Markdown
   * - `'auto'`: Auto-detect from template (default)
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
   * @default 'static'
   */
  bundlingMode?: 'static' | 'dynamic';

  /**
   * Resource loading mode.
   *
   * - `'cdn'`: Load React/MDX/Handlebars from CDN URLs (lightweight)
   * - `'inline'`: Embed all scripts in HTML (self-contained)
   *
   * Use 'cdn' for most platforms (OpenAI, ChatGPT, Cursor).
   * Use 'inline' for network-blocked environments (Claude Artifacts).
   *
   * @default 'cdn'
   */
  resourceMode?: 'cdn' | 'inline';

  /**
   * Runtime options for specific renderers.
   */
  runtimeOptions?: {
    /** Enable React hydration after SSR */
    hydrate?: boolean;
    /** Markdown rendering options */
    markdown?: {
      /** Enable GitHub-flavored markdown */
      gfm?: boolean;
      /** Syntax highlighting theme */
      highlightTheme?: string;
    };
  };

  // ============================================
  // Dual-Payload Options (Claude Artifacts)
  // ============================================

  /**
   * Prefix text shown before HTML in dual-payload responses (Claude).
   *
   * When the output mode is `'dual-payload'` (auto-detected for Claude clients),
   * the tool response contains two TextContent blocks:
   * 1. Pure JSON data: `{"temperature": 72, ...}`
   * 2. Markdown-wrapped HTML: `{prefix}:\n\n```html\n<!DOCTYPE html>...\n```
   *
   * This field controls the prefix text in block 2.
   *
   * @default 'Here is the visual result'
   *
   * @example
   * ```typescript
   * // Weather tool
   * ui: {
   *   template: WeatherWidget,
   *   htmlResponsePrefix: 'Here is the weather dashboard',
   * }
   * // Output block 2: "Here is the weather dashboard:\n\n```html\n..."
   *
   * // Stock tool
   * ui: {
   *   template: StockWidget,
   *   htmlResponsePrefix: 'Here is the stock information',
   * }
   * // Output block 2: "Here is the stock information:\n\n```html\n..."
   * ```
   */
  htmlResponsePrefix?: string;
}

/**
 * Type alias for backwards compatibility.
 * Prefer using UITemplateConfig directly.
 */
export type UITemplate<In = unknown, Out = unknown> = UITemplateConfig<In, Out>;
