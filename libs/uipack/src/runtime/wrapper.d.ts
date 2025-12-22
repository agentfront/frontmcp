/**
 * Tool UI Wrapper
 *
 * Wraps tool UI templates with the MCP Bridge runtime and
 * integrates with the existing layout system for consistent styling.
 */
import type { WrapToolUIOptions, HostContext } from './types';
import { type ThemeConfig, type PlatformCapabilities, type DeepPartial } from '../theme';
import { escapeHtml } from '../layouts/base';
import { type SanitizerFn } from './sanitizer';
/**
 * Extended options for wrapToolUI that include theme and platform
 */
export interface WrapToolUIFullOptions extends WrapToolUIOptions {
  /** Theme configuration */
  theme?: DeepPartial<ThemeConfig>;
  /** Target platform capabilities */
  platform?: PlatformCapabilities;
  /** Initial host context */
  hostContext?: Partial<HostContext>;
  /**
   * Sanitize input before exposing to widget.
   * This protects sensitive data from being exposed in client-side widgets.
   *
   * - `true`: Auto-detect and redact PII patterns (email, phone, SSN, credit card)
   * - `string[]`: Redact values in fields with these names
   * - `SanitizerFn`: Custom sanitizer function
   * - `false` or `undefined`: No sanitization (default)
   *
   * @example
   * ```typescript
   * // Auto-detect PII
   * wrapToolUI({ sanitizeInput: true, ... });
   *
   * // Redact specific fields
   * wrapToolUI({ sanitizeInput: ['password', 'token', 'api_key'], ... });
   *
   * // Custom sanitizer
   * wrapToolUI({
   *   sanitizeInput: (key, value) => key === 'secret' ? '[HIDDEN]' : value,
   *   ...
   * });
   * ```
   */
  sanitizeInput?: boolean | string[] | SanitizerFn;
  /**
   * The type of renderer used (for framework runtime injection).
   * Auto-detected by renderToolTemplateAsync.
   */
  rendererType?: string;
  /**
   * Enable client-side hydration for React/MDX components.
   */
  hydrate?: boolean;
  /**
   * Skip CSP meta tag generation.
   *
   * OpenAI handles CSP through `_meta['openai/widgetCSP']` in the MCP response,
   * not through HTML meta tags. When true, the CSP meta tag is omitted from the
   * HTML output to avoid browser warnings about CSP meta tags outside <head>.
   *
   * @default false
   */
  skipCspMeta?: boolean;
}
/**
 * Create template helpers for use in template builder functions
 */
export declare function createTemplateHelpers(): {
  /**
   * Escape HTML special characters to prevent XSS
   */
  escapeHtml: typeof escapeHtml;
  /**
   * Format a date for display
   */
  formatDate: (date: Date | string, format?: string) => string;
  /**
   * Format a number as currency
   */
  formatCurrency: (amount: number, currency?: string) => string;
  /**
   * Generate a unique ID for DOM elements
   */
  uniqueId: (prefix?: string) => string;
  /**
   * Safely embed JSON data in HTML
   * Escapes characters that could break out of script tags or HTML
   */
  jsonEmbed: (data: unknown) => string;
};
/**
 * Wrap tool UI content in a complete HTML document with MCP Bridge runtime.
 *
 * This function creates a standalone HTML document that:
 * - Includes the MCP Bridge runtime for cross-platform compatibility
 * - Applies Content Security Policy meta tags
 * - Injects tool input/output data
 * - Uses the FrontMCP theme system for consistent styling
 *
 * @param options - Options for wrapping the template
 * @returns Complete HTML document string
 *
 * @example
 * ```typescript
 * const html = wrapToolUI({
 *   content: '<div class="p-4">Weather: 72°F</div>',
 *   toolName: 'get_weather',
 *   input: { location: 'San Francisco' },
 *   output: { temperature: 72, conditions: 'sunny' },
 *   csp: { connectDomains: ['https://api.weather.com'] },
 * });
 * ```
 */
export declare function wrapToolUI(options: WrapToolUIFullOptions): string;
/**
 * Resource loading mode for widget scripts.
 * - 'cdn': Load React/MDX from CDN URLs (lightweight HTML, requires network)
 * - 'inline': Embed all scripts in HTML (larger, works offline)
 */
export type ResourceMode = 'cdn' | 'inline';
/**
 * Options for the universal wrapper.
 */
export interface WrapToolUIUniversalOptions {
  /** Rendered template content (HTML) */
  content: string;
  /** Tool name */
  toolName: string;
  /** Tool input arguments */
  input?: Record<string, unknown>;
  /** Tool output/result */
  output?: unknown;
  /** Structured content */
  structuredContent?: unknown;
  /** CSP configuration */
  csp?: WrapToolUIOptions['csp'];
  /** Widget accessibility flag */
  widgetAccessible?: boolean;
  /** Page title */
  title?: string;
  /** Theme configuration */
  theme?: DeepPartial<ThemeConfig>;
  /** Whether to include the FrontMCP Bridge */
  includeBridge?: boolean;
  /** Whether to inline all scripts (for blocked-network environments) */
  inlineScripts?: boolean;
  /** Renderer type used */
  rendererType?: string;
  /** Enable hydration */
  hydrate?: boolean;
  /**
   * Skip CSP meta tag generation.
   *
   * OpenAI handles CSP through `_meta['openai/widgetCSP']` in the MCP response,
   * not through HTML meta tags. When true, the CSP meta tag is omitted from the
   * HTML output to avoid browser warnings about CSP meta tags outside <head>.
   *
   * @default false
   */
  skipCspMeta?: boolean;
  /**
   * Resource loading mode for widget scripts.
   *
   * - 'cdn': Load React, MDX, Handlebars from CDN URLs (smaller HTML, requires network)
   * - 'inline': Embed all scripts directly in HTML (larger, works in blocked-network environments)
   *
   * When `inlineScripts` is true, this is automatically set to 'inline'.
   *
   * @default 'cdn'
   */
  resourceMode?: ResourceMode;
}
/**
 * Wrap tool UI content in a universal HTML document.
 *
 * This wrapper produces HTML that works on ALL platforms:
 * - OpenAI ChatGPT (Apps SDK)
 * - Anthropic Claude
 * - MCP Apps (ext-apps / SEP-1865)
 * - Google Gemini
 * - Any MCP-compatible host
 *
 * The FrontMCP Bridge auto-detects the host at runtime and adapts
 * its communication protocol accordingly.
 *
 * @param options - Universal wrapper options
 * @returns Complete HTML document string
 *
 * @example
 * ```typescript
 * const html = wrapToolUIUniversal({
 *   content: '<div class="p-4">Weather: 72°F</div>',
 *   toolName: 'get_weather',
 *   output: { temperature: 72 },
 * });
 * ```
 */
export declare function wrapToolUIUniversal(options: WrapToolUIUniversalOptions): string;
/**
 * Wrap tool UI content with minimal boilerplate.
 * Use this when you need to control all styling yourself.
 *
 * @param options - Minimal wrapper options
 * @returns HTML document string
 */
export declare function wrapToolUIMinimal(
  options: Pick<
    WrapToolUIOptions,
    'content' | 'toolName' | 'input' | 'output' | 'structuredContent' | 'csp' | 'widgetAccessible' | 'title'
  > & {
    skipCspMeta?: boolean;
  },
): string;
/**
 * Options for wrapping a static widget.
 */
export interface WrapStaticWidgetOptions {
  /** Tool name */
  toolName: string;
  /** SSR'd template content (rendered WITHOUT data) */
  ssrContent: string;
  /** Tool UI configuration */
  uiConfig: {
    csp?: WrapToolUIOptions['csp'];
    widgetAccessible?: boolean;
  };
  /** Page title */
  title?: string;
  /** Theme configuration */
  theme?: DeepPartial<ThemeConfig>;
  /**
   * Renderer type (react, mdx, html, etc).
   * When 'react' or 'mdx', includes React runtime for client-side rendering.
   */
  rendererType?: string;
  /**
   * Transpiled component code to include for client-side rendering.
   * Required for React components to re-render with actual data.
   */
  componentCode?: string;
  /**
   * Embedded data for inline mode (servingMode: 'inline').
   * When provided, the data is embedded in the HTML and the component renders immediately
   * instead of waiting for window.openai.toolOutput.
   *
   * This enables inline mode to use the same React renderer as static mode,
   * but with data embedded in each response.
   */
  embeddedData?: {
    input?: Record<string, unknown>;
    output?: unknown;
    structuredContent?: unknown;
  };
  /**
   * Self-contained mode for inline serving.
   * When true:
   * - Skips the FrontMCP Bridge entirely (no wrapper interference)
   * - Renders React immediately with embedded data
   * - React component manages its own state via hooks
   * - No global state updates that could trigger platform wrappers
   *
   * This is used for `servingMode: 'inline'` to prevent OpenAI's wrapper
   * from overwriting the React component on data changes.
   */
  selfContained?: boolean;
}
/**
 * Options for lean widget shell (inline mode resourceTemplate).
 */
export interface WrapLeanWidgetShellOptions {
  /** Tool name */
  toolName: string;
  /** UI configuration */
  uiConfig: {
    widgetAccessible?: boolean;
  };
  /** Optional page title */
  title?: string;
  /** Optional theme overrides */
  theme?: Partial<ThemeConfig>;
}
/**
 * Create a lean widget shell for inline mode resourceTemplate.
 *
 * This is a minimal HTML document with:
 * - HTML structure with theme CSS and fonts
 * - A placeholder/loading message while waiting for tool response
 * - FrontMCP Bridge for platform-agnostic communication
 * - Injector script that detects ui/html in tool response and replaces the document
 *
 * NO React runtime, NO component code - the actual React widget comes
 * in each tool response via _meta['ui/html'] and is injected by this shell.
 *
 * OpenAI caches this at discovery time. When a tool executes:
 * 1. Tool returns full widget HTML in _meta['ui/html']
 * 2. OpenAI injects this into window.openai.toolResponseMetadata['ui/html']
 * 3. The bridge detects this and calls the injector callback
 * 4. Injector replaces the entire document with the full React widget
 *
 * @param options - Lean widget options
 * @returns Minimal HTML document string with bridge and injector
 */
export declare function wrapLeanWidgetShell(options: WrapLeanWidgetShellOptions): string;
/**
 * Options for hybrid widget shell (hybrid mode resourceTemplate).
 */
export interface WrapHybridWidgetShellOptions {
  /** Tool name */
  toolName: string;
  /** UI configuration */
  uiConfig: {
    widgetAccessible?: boolean;
    csp?: WrapToolUIOptions['csp'];
  };
  /** Optional page title */
  title?: string;
  /** Optional theme overrides */
  theme?: Partial<ThemeConfig>;
}
/**
 * Create a hybrid widget shell for hybrid serving mode.
 *
 * This shell contains:
 * - React 19 runtime from esm.sh CDN
 * - FrontMCP Bridge for platform-agnostic communication
 * - All FrontMCP hooks (useMcpBridgeContext, useToolOutput, useCallTool, etc.)
 * - All FrontMCP UI components (Card, Badge, Button)
 * - Dynamic renderer that imports and renders component code at runtime
 *
 * NO component code is included - it comes in the tool response via `_meta['ui/component']`.
 *
 * Flow:
 * 1. Shell is cached at tools/list (OpenAI caches outputTemplate)
 * 2. Tool response contains component code + structured data
 * 3. Shell imports component via blob URL and renders with data
 * 4. Re-renders on data updates via bridge notifications
 *
 * @param options - Hybrid widget shell options
 * @returns Complete HTML document string with dynamic renderer
 */
export declare function wrapHybridWidgetShell(options: WrapHybridWidgetShellOptions): string;
/**
 * Wrap a static widget template for MCP resource mode.
 *
 * Unlike `wrapToolUIUniversal`, this function creates a widget that:
 * - Does NOT embed data (input/output/structuredContent)
 * - Reads data at runtime from the FrontMCP Bridge (window.openai.toolOutput)
 * - Is cached at server startup and returned for all requests
 *
 * This is used for `servingMode: 'static'` where OpenAI caches the
 * outputTemplate HTML and injects data via window.openai.toolOutput.
 *
 * @param options - Static widget options
 * @returns Complete HTML document string
 *
 * @example
 * ```typescript
 * const html = wrapStaticWidgetUniversal({
 *   toolName: 'get_weather',
 *   ssrContent: '<div class="weather-card"><!-- Template without data --></div>',
 *   uiConfig: { widgetAccessible: true },
 * });
 * ```
 */
export declare function wrapStaticWidgetUniversal(options: WrapStaticWidgetOptions): string;
/**
 * Build OpenAI Apps SDK specific meta annotations.
 * These are placed in _meta field of the tool response.
 */
export declare function buildOpenAIMeta(options: {
  csp?: WrapToolUIOptions['csp'];
  widgetAccessible?: boolean;
  widgetDescription?: string;
  displayMode?: 'inline' | 'fullscreen' | 'pip';
}): Record<string, unknown>;
/**
 * Get the MIME type for tool UI responses based on target platform
 */
export declare function getToolUIMimeType(platform?: 'openai' | 'ext-apps' | 'generic'): string;
/**
 * Options for Claude-specific wrapper.
 */
export interface WrapToolUIForClaudeOptions {
  /** Rendered template content (HTML body) */
  content: string;
  /** Tool name */
  toolName: string;
  /** Tool input arguments */
  input?: Record<string, unknown>;
  /** Tool output/result */
  output?: unknown;
  /** Page title */
  title?: string;
  /** Include HTMX for dynamic interactions */
  includeHtmx?: boolean;
  /** Include Alpine.js for reactive components */
  includeAlpine?: boolean;
}
/**
 * Wrap tool UI content for Claude Artifacts.
 *
 * Creates a complete HTML document using Cloudflare CDN resources
 * which are trusted by Claude's sandbox environment.
 *
 * Key differences from standard wrapper:
 * - Uses pre-built Tailwind CSS from cloudflare (not JIT compiler)
 * - No esm.sh imports (Claude blocks non-cloudflare CDNs)
 * - No React runtime (SSR-only, static HTML)
 * - Self-contained with embedded data
 *
 * @param options - Claude wrapper options
 * @returns Complete HTML document string
 *
 * @example
 * ```typescript
 * const html = wrapToolUIForClaude({
 *   content: '<div class="p-4 bg-gray-100">Weather: 72°F</div>',
 *   toolName: 'get_weather',
 *   output: { temperature: 72 },
 * });
 * // Returns full HTML with Tailwind CSS from cloudflare CDN
 * ```
 */
export declare function wrapToolUIForClaude(options: WrapToolUIForClaudeOptions): string;
//# sourceMappingURL=wrapper.d.ts.map
