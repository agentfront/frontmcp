/**
 * Widget Runtime Types
 *
 * Core types for the Tool UI widget system. These types define:
 * - UI rendering modes (html, react, mdx, markdown, auto)
 * - Bundling strategies (static vs dynamic)
 * - Widget manifests for caching and discovery
 * - Runtime payloads for tool responses
 * - CSP directives for security
 *
 * This module is the canonical source for widget types.
 * Both `@frontmcp/sdk` and external consumers (like AgentLink)
 * should import types from here.
 *
 * @packageDocumentation
 */

// Import types from ui-config for use in this file
import type { WidgetServingMode as _WidgetServingMode } from './ui-config';
import type { ZodTypeAny } from 'zod';

// Re-export shared types from ui-config for backwards compatibility
export type {
  TemplateHelpers,
  TemplateContext,
  TemplateBuilderFn,
  UIContentSecurityPolicy,
  WidgetDisplayMode,
  WidgetServingMode,
} from './ui-config';

// Use the internal alias for WidgetServingMode within this file
type WidgetServingMode = _WidgetServingMode;

// ============================================
// UI Type (Renderer Selection)
// ============================================

/**
 * UI renderer type for widget templates.
 *
 * - `'html'`: Plain HTML template (with optional Handlebars enhancement)
 * - `'react'`: React component (SSR + optional hydration)
 * - `'mdx'`: MDX template (Markdown + JSX components)
 * - `'markdown'`: Pure Markdown (rendered via markdown engine)
 * - `'auto'`: Auto-detect from template; loads all renderers at runtime
 *
 * @example
 * ```typescript
 * // Explicit HTML mode
 * ui: {
 *   template: '<div>{{output.value}}</div>',
 *   uiType: 'html'
 * }
 *
 * // Auto-detect (loads all renderers)
 * ui: {
 *   template: MyReactComponent,
 *   uiType: 'auto'
 * }
 * ```
 */
export type UIType = 'html' | 'react' | 'mdx' | 'markdown' | 'auto';

// ============================================
// Bundling Mode
// ============================================

/**
 * Widget bundling strategy.
 *
 * - `'static'`: Widget shell is pre-compiled at startup and cached.
 *   Tool responses reference the cached widget via `ui://widget/{toolName}`.
 *   Data is injected at runtime via FrontMCP Bridge. **Default mode.**
 *
 * - `'dynamic'`: Fresh HTML is generated for each tool invocation.
 *   Use for debugging or when template logic depends on invocation context.
 *
 * @example
 * ```typescript
 * // Static mode (default, recommended)
 * ui: {
 *   template: WeatherWidget,
 *   bundlingMode: 'static'
 * }
 *
 * // Dynamic mode (debugging, fresh per call)
 * ui: {
 *   template: (ctx) => `<div>${ctx.output.debug}</div>`,
 *   bundlingMode: 'dynamic'
 * }
 * ```
 */
export type BundlingMode = 'static' | 'dynamic';

// ============================================
// Resource Mode (CDN vs Inline)
// ============================================

/**
 * Resource loading mode for widget dependencies.
 *
 * - `'cdn'`: Load React/MDX/Handlebars from CDN URLs (light, fast).
 *   Requires network access. Best for most platforms.
 *
 * - `'inline'`: Embed all scripts directly in the HTML (self-contained).
 *   Works in network-blocked environments (e.g., Claude Artifacts).
 *   Results in larger HTML payloads.
 *
 * @example
 * ```typescript
 * // CDN mode (default, lightweight)
 * ui: {
 *   template: WeatherWidget,
 *   resourceMode: 'cdn'
 * }
 *
 * // Inline mode (network-blocked environments)
 * ui: {
 *   template: WeatherWidget,
 *   resourceMode: 'inline'
 * }
 * ```
 */
export type ResourceMode = 'cdn' | 'inline';

// ============================================
// Output Mode (Client-Adaptive)
// ============================================

/**
 * Widget output mode - determines what is returned in tool responses.
 *
 * - `'code-only'`: Return just the transpiled/rendered content.
 *   The host platform (OpenAI, etc.) provides the runtime wrapper.
 *   Best for capable platforms that handle their own rendering.
 *
 * - `'full-ssr'`: Return complete SSR'd HTML with embedded data.
 *   Self-contained output for limited/unknown MCP clients.
 *   Includes FrontMCP Bridge, scripts, and all necessary runtime.
 *
 * - `'dual-payload'`: Return TWO TextContent blocks for Claude Artifacts.
 *   Block 0: Pure JSON stringified data (for programmatic parsing).
 *   Block 1: Markdown-wrapped HTML (```html...```) for visual rendering.
 *   Uses cloudflare CDN for all resources (Claude sandbox restriction).
 *
 * @example
 * ```typescript
 * // For OpenAI - just return the rendered content
 * const result = await buildWidgetOutput({
 *   uiConfig,
 *   toolName: 'weather',
 *   outputMode: 'code-only',
 *   output: { temperature: 72 },
 * });
 * // result.content = '<div class="weather">72°F</div>'
 *
 * // For unknown clients - return full HTML
 * const result = await buildWidgetOutput({
 *   uiConfig,
 *   toolName: 'weather',
 *   outputMode: 'full-ssr',
 *   output: { temperature: 72 },
 * });
 * // result.html = '<!DOCTYPE html>...'
 *
 * // For Claude - return dual-payload
 * const result = await buildWidgetOutput({
 *   uiConfig,
 *   toolName: 'weather',
 *   outputMode: 'dual-payload',
 *   output: { temperature: 72 },
 * });
 * // result.content = [
 * //   { type: 'text', text: '{"temperature":72}' },
 * //   { type: 'text', text: 'Here is the weather:\n\n```html\n<!DOCTYPE html>...\n```' }
 * // ]
 * ```
 */
export type OutputMode = 'code-only' | 'full-ssr' | 'dual-payload';

/**
 * Display mode for widget presentation.
 *
 * Note: This is an alias for `WidgetDisplayMode` from ui-config.ts.
 * Prefer using `WidgetDisplayMode` for new code.
 */
export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

// ============================================
// CSP Directives (Granular)
// ============================================

/**
 * Content Security Policy directives for widget sandboxes.
 *
 * More granular than `UIContentSecurityPolicy`, this type
 * maps directly to CSP header directives.
 *
 * @example
 * ```typescript
 * const csp: CSPDirectives = {
 *   scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
 *   styleSrc: ["'self'", "'unsafe-inline'"],
 *   connectSrc: ["https://api.example.com"],
 * };
 * ```
 */
export interface CSPDirectives {
  /**
   * Script source directives (CSP script-src).
   * @example ["'self'", "'unsafe-inline'", "https://unpkg.com"]
   */
  scriptSrc: string[];

  /**
   * Style source directives (CSP style-src).
   * @example ["'self'", "'unsafe-inline'"]
   */
  styleSrc: string[];

  /**
   * Connection source directives (CSP connect-src).
   * Controls fetch/XHR/WebSocket destinations.
   * @example ["https://api.example.com"]
   */
  connectSrc: string[];

  /**
   * Image source directives (CSP img-src).
   * @example ["'self'", "data:", "https://images.example.com"]
   */
  imgSrc?: string[];

  /**
   * Font source directives (CSP font-src).
   * @example ["'self'", "https://fonts.gstatic.com"]
   */
  fontSrc?: string[];

  /**
   * Default source directive (CSP default-src).
   * @example ["'self'"]
   */
  defaultSrc?: string[];

  /**
   * Frame source directives (CSP frame-src).
   * @example ["'none'"]
   */
  frameSrc?: string[];

  /**
   * Object source directives (CSP object-src).
   * @example ["'none'"]
   */
  objectSrc?: string[];
}

// ============================================
// CDN Resource
// ============================================

/**
 * CDN configuration for a single script resource.
 */
export interface CDNResource {
  /**
   * CDN URL for the script.
   */
  url: string;

  /**
   * Subresource integrity hash (SRI).
   * @example "sha384-..."
   */
  integrity?: string;

  /**
   * Crossorigin attribute.
   * @default "anonymous"
   */
  crossorigin?: 'anonymous' | 'use-credentials';
}

// ============================================
// Renderer Assets
// ============================================

/**
 * External assets required by a renderer type.
 *
 * Supports two modes:
 * - CDN mode: Light payloads, scripts loaded from CDN URLs
 * - Inline mode: Self-contained, scripts embedded in HTML
 *
 * @example
 * ```typescript
 * // CDN mode (lightweight)
 * const assets: RendererAssets = {
 *   mode: 'cdn',
 *   react: { url: 'https://unpkg.com/react@18/umd/react.production.min.js' },
 *   reactDom: { url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js' },
 * };
 *
 * // Inline mode (self-contained)
 * const assets: RendererAssets = {
 *   mode: 'inline',
 *   inlineReact: '/* minified react code *\/',
 *   inlineReactDom: '/* minified react-dom code *\/',
 * };
 * ```
 */
export interface RendererAssets {
  /**
   * Resource loading mode.
   * - 'cdn': Load scripts from CDN URLs (light, requires network)
   * - 'inline': Embed scripts in HTML (heavy, works offline)
   * @default 'cdn'
   */
  mode: ResourceMode;

  // ========== CDN Resources ==========

  /**
   * React UMD runtime CDN (for 'react' UI type).
   */
  react?: CDNResource;

  /**
   * ReactDOM UMD runtime CDN (for 'react' UI type with hydration).
   */
  reactDom?: CDNResource;

  /**
   * Markdown rendering engine CDN (for 'markdown' or 'mdx' types).
   */
  markdown?: CDNResource;

  /**
   * MDX runtime CDN (for 'mdx' type).
   */
  mdxRuntime?: CDNResource;

  /**
   * Handlebars runtime CDN (for enhanced HTML templates).
   */
  handlebars?: CDNResource;

  /**
   * Tailwind CSS CDN.
   */
  tailwind?: CDNResource;

  // ========== Inline Resources ==========

  /**
   * Inline React runtime (for inline mode).
   * Contains minified React UMD bundle.
   */
  inlineReact?: string;

  /**
   * Inline ReactDOM runtime (for inline mode).
   * Contains minified ReactDOM UMD bundle.
   */
  inlineReactDom?: string;

  /**
   * Inline Handlebars runtime (for inline mode).
   */
  inlineHandlebars?: string;

  /**
   * Inline Markdown engine (for inline mode).
   */
  inlineMarkdown?: string;

  /**
   * Inline bundle content (compiled widget template).
   * Contains the pre-bundled renderer + template code.
   */
  inlineBundle?: string;

  // ========== Metadata ==========

  /**
   * Content hash of the bundled widget code.
   * Used for cache invalidation.
   */
  bundleHash?: string;

  // ========== Legacy (deprecated) ==========

  /**
   * @deprecated Use `react.url` instead
   */
  reactRuntime?: string;

  /**
   * @deprecated Use `reactDom.url` instead
   */
  reactDomRuntime?: string;

  /**
   * @deprecated Use `markdown.url` instead
   */
  markdownEngine?: string;

  /**
   * @deprecated Use `handlebars.url` instead
   */
  handlebarsRuntime?: string;
}

// ============================================
// Widget Manifest
// ============================================

/**
 * Widget manifest describing a pre-compiled static widget.
 *
 * The manifest is embedded in the widget HTML and also cached
 * separately for quick lookups. It contains all metadata needed
 * for the runtime to render the widget correctly.
 *
 * @example
 * ```json
 * {
 *   "tool": "weather.get",
 *   "uiType": "react",
 *   "bundlingMode": "static",
 *   "displayMode": "inline",
 *   "widgetAccessible": true,
 *   "schema": { "type": "object", "properties": {...} },
 *   "csp": { "scriptSrc": ["'self'"], ... },
 *   "rendererAssets": { "reactRuntime": "https://..." },
 *   "hash": "sha256-abc123..."
 * }
 * ```
 */
export interface WidgetManifest {
  /**
   * Tool name (unique identifier).
   * @example "weather.get"
   */
  tool: string;

  /**
   * UI renderer type.
   */
  uiType: UIType;

  /**
   * Bundling mode used to create this widget.
   */
  bundlingMode: BundlingMode;

  /**
   * Preferred display mode for the widget.
   */
  displayMode: DisplayMode;

  /**
   * Whether the widget can invoke tools via MCP bridge.
   * When true, widget has access to `window.mcpBridge.callTool()`.
   */
  widgetAccessible: boolean;

  /**
   * JSON Schema describing the tool's output structure.
   * Used for type hints and validation.
   */
  schema: object;

  /**
   * Content Security Policy directives.
   */
  csp: CSPDirectives;

  /**
   * External assets required by the renderer.
   */
  rendererAssets: RendererAssets;

  /**
   * SHA-256 hash of the manifest + HTML content.
   * Used for cache validation and ETag generation.
   */
  hash: string;

  /**
   * Timestamp when the manifest was created (ISO 8601).
   */
  createdAt?: string;

  /**
   * Human-readable description of the widget.
   */
  description?: string;

  /**
   * Widget URI in the MCP resource format.
   * @example "ui://widget/weather.get.html"
   */
  uri?: string;
}

// ============================================
// Runtime Payload (_meta fields)
// ============================================

/**
 * UI metadata fields emitted in tool response `_meta`.
 *
 * All UI-related data goes in `_meta`, NOT in the `content` array.
 * The MCP client reads these fields to render the widget.
 *
 * @example
 * ```typescript
 * // Tool response structure
 * {
 *   content: [{ type: 'text', text: 'Weather data retrieved' }],
 *   _meta: {
 *     // UI type for renderer selection
 *     'ui/type': 'react',
 *
 *     // Transpiled widget code (for capable clients like OpenAI)
 *     'ui/content': '<div class="weather">72°F Sunny</div>',
 *
 *     // OR full HTML (for limited clients)
 *     'ui/html': '<!DOCTYPE html>...',
 *
 *     // Content hash for caching
 *     'ui/hash': 'sha256-abc123...',
 *
 *     // Display mode hint
 *     'ui/displayMode': 'inline',
 *
 *     // Widget can call tools
 *     'ui/widgetAccessible': true,
 *
 *     // OpenAI-specific CSP
 *     'openai/widgetCSP': { connect_domains: ['api.weather.com'] },
 *   }
 * }
 * ```
 */
export interface UIMetaFields {
  /**
   * UI renderer type.
   * Maps to `_meta['ui/type']`.
   */
  'ui/type': UIType;

  /**
   * Transpiled widget content (code-only mode).
   * Just the rendered template without wrapper HTML.
   * Use for capable clients (OpenAI) that provide their own runtime.
   * Maps to `_meta['ui/content']`.
   */
  'ui/content'?: string;

  /**
   * Full HTML document (full-ssr mode).
   * Complete self-contained HTML with scripts, bridge, etc.
   * Use for limited/unknown MCP clients.
   * Maps to `_meta['ui/html']`.
   */
  'ui/html'?: string;

  /**
   * Content hash for cache validation.
   * Maps to `_meta['ui/hash']`.
   */
  'ui/hash': string;

  /**
   * Display mode hint.
   * Maps to `_meta['ui/displayMode']`.
   */
  'ui/displayMode'?: DisplayMode;

  /**
   * Whether widget can invoke tools via MCP bridge.
   * Maps to `_meta['ui/widgetAccessible']`.
   */
  'ui/widgetAccessible'?: boolean;

  /**
   * Widget description for accessibility.
   * Maps to `_meta['ui/description']`.
   */
  'ui/description'?: string;

  /**
   * Resource mode used (cdn or inline).
   * Maps to `_meta['ui/resourceMode']`.
   */
  'ui/resourceMode'?: ResourceMode;
}

/**
 * OpenAI-specific meta fields.
 * These are in addition to the standard UI fields.
 */
export interface OpenAIMetaFields {
  /**
   * OpenAI CSP configuration.
   * Maps to `_meta['openai/widgetCSP']`.
   */
  'openai/widgetCSP'?: {
    connect_domains?: string[];
    resource_domains?: string[];
  };

  /**
   * OpenAI widget accessible flag.
   * Maps to `_meta['openai/widgetAccessible']`.
   */
  'openai/widgetAccessible'?: boolean;

  /**
   * OpenAI widget description.
   * Maps to `_meta['openai/widgetDescription']`.
   */
  'openai/widgetDescription'?: string;

  /**
   * OpenAI display mode.
   * Maps to `_meta['openai/displayMode']`.
   */
  'openai/displayMode'?: 'inline' | 'fullscreen' | 'pip';
}

/**
 * Combined meta fields for tool responses.
 * Includes both standard UI fields and platform-specific fields.
 */
export type ToolResponseMeta = Partial<UIMetaFields> & Partial<OpenAIMetaFields> & Record<string, unknown>;

/**
 * @deprecated Use UIMetaFields instead. RuntimePayload is being replaced
 * with explicit _meta field types.
 */
export interface RuntimePayload {
  /**
   * Resolved UI type for this invocation.
   * @deprecated Use UIMetaFields['ui/type']
   */
  type: UIType;

  /**
   * Rendered/compiled content.
   * @deprecated Use UIMetaFields['ui/content']
   */
  content: string;

  /**
   * Content hash for cache validation.
   * @deprecated Use UIMetaFields['ui/hash']
   */
  hash: string;

  /**
   * Hydration data for React components.
   */
  hydrationData?: unknown;

  /**
   * Structured tool output (JSON-serializable).
   */
  toolOutput?: unknown;

  /**
   * Additional metadata for the runtime.
   */
  metadata?: Record<string, unknown>;
}

// ============================================
// Widget Configuration
// ============================================

/**
 * Widget template types supported by the system.
 *
 * - String: HTML/MDX/Markdown content
 * - Builder function: Receives context, returns HTML string
 * - React component: SSR'd with props from context
 */
export type WidgetTemplate =
  | string
  | ((ctx: WidgetTemplateContext) => string)
  | React.ComponentType<WidgetTemplateContext>;

/**
 * Context passed to widget templates.
 *
 * This is a more specific version of `TemplateContext` with
 * explicit typing for widget rendering.
 */
export interface WidgetTemplateContext<Input = Record<string, unknown>, Output = unknown> {
  /**
   * Tool input arguments.
   */
  input: Input;

  /**
   * Tool output/result.
   */
  output: Output;

  /**
   * Structured content parsed from output (if schema provided).
   */
  structuredContent?: unknown;

  /**
   * Template helper functions.
   */
  helpers: WidgetTemplateHelpers;
}

/**
 * Helper functions available in widget templates.
 */
export interface WidgetTemplateHelpers {
  /**
   * Escape HTML special characters to prevent XSS.
   * Handles null/undefined by returning empty string.
   */
  escapeHtml(str: unknown): string;

  /**
   * Format a date for display.
   * @param date - Date object or ISO string
   * @param format - Optional format string
   */
  formatDate(date: Date | string, format?: string): string;

  /**
   * Format a number as currency.
   * @param amount - Numeric amount
   * @param currency - ISO 4217 currency code (default: 'USD')
   */
  formatCurrency(amount: number, currency?: string): string;

  /**
   * Generate a unique ID for DOM elements.
   * @param prefix - Optional prefix
   */
  uniqueId(prefix?: string): string;

  /**
   * Safely embed JSON data in HTML.
   * Escapes script-breaking characters.
   */
  jsonEmbed(data: unknown): string;

  /**
   * Conditionally join class names.
   * @param classes - Class names (falsy values are filtered)
   */
  classNames(...classes: (string | false | undefined | null)[]): string;

  /**
   * Format a number with locale-aware separators.
   */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
}

/**
 * Widget configuration for tool UI templates.
 *
 * This is the main configuration type used in tool decorators
 * and standalone widget compilation.
 *
 * @example
 * ```typescript
 * const config: WidgetConfig = {
 *   template: WeatherWidget,
 *   uiType: 'react',
 *   bundlingMode: 'static',
 *   displayMode: 'inline',
 *   widgetAccessible: true,
 *   csp: { connectSrc: ['https://api.weather.com'] },
 * };
 * ```
 */
export interface WidgetConfig<Input = Record<string, unknown>, Output = unknown> {
  /**
   * Widget template.
   *
   * Supports:
   * - HTML string (with optional Handlebars syntax)
   * - MDX string
   * - Template builder function
   * - React component
   */
  template: WidgetTemplate | ((ctx: WidgetTemplateContext<Input, Output>) => string);

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
  uiType?: UIType;

  /**
   * Bundling mode.
   *
   * - `'static'`: Pre-compile widget shell, inject data at runtime (default)
   * - `'dynamic'`: Generate fresh HTML per tool invocation
   *
   * @default 'static'
   */
  bundlingMode?: BundlingMode;

  /**
   * Display mode preference.
   *
   * - `'inline'`: Render inline in conversation (default)
   * - `'fullscreen'`: Request fullscreen display
   * - `'pip'`: Picture-in-picture mode
   *
   * @default 'inline'
   */
  displayMode?: DisplayMode;

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
  resourceMode?: ResourceMode;

  /**
   * Content Security Policy overrides.
   *
   * Merged with auto-generated CSP based on uiType.
   */
  csp?: Partial<CSPDirectives>;

  /**
   * Whether widget can invoke tools via MCP bridge.
   *
   * When true, widget gets access to `window.mcpBridge.callTool()`.
   *
   * @default false
   */
  widgetAccessible?: boolean;

  /**
   * Human-readable description shown to users.
   * Maps to OpenAI's `openai/widgetDescription`.
   */
  widgetDescription?: string;

  /**
   * Runtime options for specific renderers.
   */
  runtimeOptions?: WidgetRuntimeOptions;

  /**
   * Custom MDX components available in templates.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, any>;

  /**
   * Status messages during tool invocation (OpenAI-specific).
   */
  invocationStatus?: {
    /** Status text while tool is executing */
    invoking?: string;
    /** Status text after execution completes */
    invoked?: string;
  };

  // ============================================
  // Serving Mode Options
  // ============================================

  /**
   * How the widget HTML should be served to the client.
   *
   * - `'inline'`: HTML embedded directly in tool response `_meta['ui/html']`
   * - `'static'`: Pre-compiled at startup, via `ui://` resource URI (MCP resources/read)
   * - `'hybrid'`: Shell pre-compiled at startup, component in response
   * - `'direct-url'`: HTTP endpoint on MCP server
   * - `'custom-url'`: Custom URL (CDN or external hosting)
   *
   * @default 'inline'
   */
  servingMode?: WidgetServingMode;

  /**
   * Custom URL for widget serving when `servingMode: 'custom-url'`.
   * The URL can include `{token}` placeholder which will be replaced
   * with the widget access token.
   *
   * @example 'https://cdn.example.com/widgets/weather.html?token={token}'
   */
  customWidgetUrl?: string;

  /**
   * Path for direct URL serving when `servingMode: 'direct-url'`.
   * This path is appended to the MCP server's base URL.
   *
   * @example '/widgets/weather'
   */
  directPath?: string;

  // ============================================
  // MCP Apps (ext-apps) Specific Options
  // ============================================

  /**
   * Whether to show a border around the UI widget.
   * MCP Apps spec: `_meta.ui.prefersBorder`
   *
   * @default undefined (host decides)
   */
  prefersBorder?: boolean;

  /**
   * Dedicated sandbox domain for the widget.
   * MCP Apps spec: `_meta.ui.domain`
   *
   * @example 'sandbox.example.com'
   */
  sandboxDomain?: string;

  // ============================================
  // Hydration Options
  // ============================================

  /**
   * Enable client-side React hydration after server-side rendering (SSR).
   *
   * **Default: `false`**
   *
   * When `false` (default):
   * - SSR output is static HTML
   * - No React runtime loaded on client
   * - Interactivity via FrontMCP Bridge
   *
   * When `true`:
   * - React/ReactDOM scripts included
   * - Client attempts hydration
   * - May cause hydration errors in MCP clients
   *
   * @default false
   */
  hydrate?: boolean;
}

/**
 * Runtime options for widget renderers.
 */
export interface WidgetRuntimeOptions {
  /**
   * Enable React hydration after SSR.
   *
   * **Default: false**
   *
   * When false (recommended):
   * - SSR output is static HTML
   * - No React runtime loaded on client
   * - Interactivity via FrontMCP Bridge
   *
   * When true:
   * - React/ReactDOM scripts included
   * - Client attempts hydration
   * - May cause hydration errors in MCP clients
   */
  hydrate?: boolean;

  /**
   * Markdown rendering options.
   */
  markdown?: {
    /** Enable GitHub-flavored markdown */
    gfm?: boolean;
    /** Syntax highlighting theme */
    highlightTheme?: string;
    /** Custom renderer overrides */
    rendererOverrides?: Record<string, unknown>;
  };

  /**
   * Handlebars options (for HTML templates).
   */
  handlebars?: {
    /** Custom helpers to register */
    helpers?: Record<string, (...args: unknown[]) => string>;
    /** Custom partials */
    partials?: Record<string, string>;
    /** Strict mode (error on missing variables) */
    strict?: boolean;
  };
}

// ============================================
// Build Result Types
// ============================================

/**
 * Result of building a widget manifest.
 *
 * Returned by `buildToolWidgetManifest()` and used
 * by `ToolUIRegistry` for caching.
 *
 * The result contains both:
 * - `content`: Just the rendered template (for capable clients like OpenAI)
 * - `html`: Complete HTML document (for limited/unknown clients)
 *
 * Choose which to use based on the target client capabilities.
 */
export interface BuildManifestResult {
  /**
   * Rendered template content (transpiled code).
   *
   * This is just the template output WITHOUT the wrapper HTML.
   * Use this for capable clients (OpenAI, etc.) that provide
   * their own runtime environment.
   *
   * @example
   * For a React component, this would be the SSR'd HTML:
   * `<div class="weather-card"><h1>72°F</h1><p>Sunny</p></div>`
   */
  content: string;

  /**
   * Complete HTML document string.
   *
   * Contains embedded manifest, FrontMCP Bridge, scripts, and template.
   * Use this for limited/unknown MCP clients that need a
   * self-contained HTML document.
   *
   * @example
   * `<!DOCTYPE html><html>...<body>{{content}}</body></html>`
   */
  html: string;

  /**
   * Widget manifest (also embedded in HTML).
   */
  manifest: WidgetManifest;

  /**
   * Content hash for cache validation.
   */
  hash: string;

  /**
   * Resolved renderer type.
   */
  rendererType: UIType;

  /**
   * Transpiled component code for client-side rendering.
   *
   * For React/MDX templates, this contains the transpiled component
   * that can be embedded in the widget HTML for client-side re-rendering
   * when tool output becomes available.
   *
   * This is used by `wrapStaticWidgetUniversal` for static mode.
   */
  componentCode?: string;

  /**
   * Size of content in bytes.
   */
  contentSize: number;

  /**
   * Size of full HTML in bytes.
   */
  htmlSize: number;

  /**
   * Estimated gzipped size of full HTML.
   */
  gzipSize: number;

  /**
   * @deprecated Use `htmlSize` instead
   */
  size: number;
}

/**
 * Options for building a widget manifest.
 */
export interface BuildManifestOptions<Input = Record<string, unknown>, Output = unknown> {
  /**
   * Tool name (unique identifier).
   */
  toolName: string;

  /**
   * Widget configuration.
   */
  uiConfig: WidgetConfig<Input, Output>;

  /**
   * JSON Schema for tool output.
   * Used for validation and type hints.
   */
  schema?: object;

  /**
   * Theme configuration override.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme?: any;

  /**
   * Sample input for SSR (static mode).
   * Used during pre-compilation.
   */
  sampleInput?: Input;

  /**
   * Sample output for SSR (static mode).
   * Used during pre-compilation.
   */
  sampleOutput?: Output;

  /**
   * Zod schema for output validation.
   *
   * When provided in development mode (NODE_ENV !== 'production'),
   * the template will be validated against this schema to catch
   * Handlebars expressions referencing non-existent fields.
   *
   * @example
   * ```typescript
   * outputSchema: z.object({
   *   temperature: z.number(),
   *   conditions: z.string(),
   * })
   * ```
   */
  outputSchema?: ZodTypeAny;

  /**
   * Zod schema for input validation.
   *
   * When provided in development mode (NODE_ENV !== 'production'),
   * the template will also validate {{input.*}} expressions.
   */
  inputSchema?: ZodTypeAny;
}

// ============================================
// Type Guards
// ============================================

/**
 * Check if a value is a valid UIType.
 */
export function isUIType(value: unknown): value is UIType {
  return typeof value === 'string' && ['html', 'react', 'mdx', 'markdown', 'auto'].includes(value);
}

/**
 * Check if a value is a valid BundlingMode.
 */
export function isBundlingMode(value: unknown): value is BundlingMode {
  return typeof value === 'string' && ['static', 'dynamic'].includes(value);
}

/**
 * Check if a value is a valid ResourceMode.
 */
export function isResourceMode(value: unknown): value is ResourceMode {
  return typeof value === 'string' && ['cdn', 'inline'].includes(value);
}

/**
 * Check if a value is a valid DisplayMode.
 */
export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && ['inline', 'fullscreen', 'pip'].includes(value);
}

/**
 * Check if a value is a valid OutputMode.
 */
export function isOutputMode(value: unknown): value is OutputMode {
  return typeof value === 'string' && ['code-only', 'full-ssr'].includes(value);
}

// ============================================
// Default Values
// ============================================

/**
 * Default CSP directives for different UI types.
 */
export const DEFAULT_CSP_BY_TYPE: Record<UIType, CSPDirectives> = {
  html: {
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: [],
  },
  react: {
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: [],
  },
  mdx: {
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: [],
  },
  markdown: {
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: [],
  },
  auto: {
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: [],
  },
};

/**
 * Default renderer assets for different UI types.
 */
export const DEFAULT_RENDERER_ASSETS: Record<UIType, Partial<RendererAssets>> = {
  html: {
    handlebarsRuntime: 'https://unpkg.com/handlebars@latest/dist/handlebars.runtime.min.js',
  },
  react: {
    reactRuntime: 'https://unpkg.com/react@18/umd/react.production.min.js',
    reactDomRuntime: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  },
  mdx: {
    reactRuntime: 'https://unpkg.com/react@18/umd/react.production.min.js',
    reactDomRuntime: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
    markdownEngine: 'https://unpkg.com/marked@latest/marked.min.js',
  },
  markdown: {
    markdownEngine: 'https://unpkg.com/marked@latest/marked.min.js',
  },
  auto: {
    reactRuntime: 'https://unpkg.com/react@18/umd/react.production.min.js',
    reactDomRuntime: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
    markdownEngine: 'https://unpkg.com/marked@latest/marked.min.js',
    handlebarsRuntime: 'https://unpkg.com/handlebars@latest/dist/handlebars.runtime.min.js',
  },
};

// ============================================
// React Type Declaration (for JSX support)
// ============================================

/**
 * React namespace declaration for type safety.
 * This allows React.ComponentType to work without importing React.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace React {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ComponentType<P = any> = (props: P) => any;
}
