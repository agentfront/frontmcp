/**
 * Tool UI Configuration Types
 *
 * Types for configuring UI templates on tools. These are extracted
 * to a separate file to enable clean imports by @frontmcp/ui without
 * circular dependencies.
 */

// ============================================
// Content Security Policy
// ============================================

/**
 * Content Security Policy for UI templates rendered in sandboxed iframes.
 * Based on OpenAI Apps SDK and ext-apps (SEP-1865) specifications.
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
export interface TemplateContext<In, Out> {
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
export type TemplateBuilderFn<In, Out> = (ctx: TemplateContext<In, Out>) => string;

// ============================================
// Tool UI Configuration
// ============================================

/**
 * Widget serving mode determines how the widget HTML is delivered to the client.
 */
export type WidgetServingMode =
  | 'inline' // HTML embedded directly in tool response _meta
  | 'mcp-resource' // Via ui:// resource URI (MCP resources/read)
  | 'direct-url' // HTTP endpoint on MCP server
  | 'custom-url'; // Custom URL (CDN or external hosting)

/**
 * UI template configuration for tools.
 * Enables rendering interactive widgets for tool responses in supported hosts
 * (OpenAI Apps SDK, ext-apps, etc.).
 *
 * @example
 * ```typescript
 * @Tool({
 *   name: 'get_weather',
 *   inputSchema: { location: z.string() },
 *   outputSchema: z.object({ temperature: z.number(), conditions: z.string() }),
 *   ui: {
 *     template: (ctx) => `
 *       <div class="p-4">
 *         <h2>${ctx.helpers.escapeHtml(ctx.input.location)}</h2>
 *         <p>${ctx.output.temperature}°F - ${ctx.output.conditions}</p>
 *       </div>
 *     `,
 *     csp: { connectDomains: ['https://api.weather.com'] },
 *     widgetAccessible: true,
 *   }
 * })
 * ```
 */
export interface ToolUIConfig<In = unknown, Out = unknown> {
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
  displayMode?: 'inline' | 'fullscreen' | 'pip';

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
   * - `'inline'`: HTML embedded directly in tool response `_meta['ui/html']`
   *   Best for small widgets, works on all platforms including network-blocked ones.
   *
   * - `'mcp-resource'`: Widget registered as MCP resource with `ui://` URI.
   *   Client fetches via `resources/read`. Good for OpenAI's template system.
   *
   * - `'direct-url'`: Served from MCP server's HTTP endpoint.
   *   Avoids third-party cookie issues since widget loads from same domain.
   *
   * - `'custom-url'`: Served from a custom URL (CDN, external hosting).
   *   Requires `customWidgetUrl` to be set.
   *
   * Default: `'inline'`
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
}
