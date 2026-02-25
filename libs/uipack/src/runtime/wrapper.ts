/**
 * Tool UI Wrapper
 *
 * Wraps tool UI templates with the MCP Bridge runtime and
 * integrates with the existing layout system for consistent styling.
 */

import type { WrapToolUIOptions, HostContext } from './types';
import { MCP_BRIDGE_RUNTIME } from './mcp-bridge';
import { buildCSPMetaTag } from './csp';
import {
  type ThemeConfig,
  type PlatformCapabilities,
  DEFAULT_THEME,
  OPENAI_PLATFORM,
  buildFontPreconnect,
  buildFontStylesheets,
  buildCdnScripts,
  buildThemeCss,
  mergeThemes,
  canUseCdn,
  needsInlineScripts,
  type DeepPartial,
} from '../theme';
import { escapeHtml } from '../utils';
import { sanitizeInput as sanitizeInputFn, type SanitizerFn } from './sanitizer';
import { BRIDGE_SCRIPT_TAGS } from '../bridge-runtime';

// ============================================
// Extended Options
// ============================================

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

// ============================================
// Template Helpers Implementation
// ============================================

/**
 * Create template helpers for use in template builder functions
 */
export function createTemplateHelpers() {
  let idCounter = 0;

  return {
    /**
     * Escape HTML special characters to prevent XSS
     */
    escapeHtml,

    /**
     * Format a date for display
     */
    formatDate: (date: Date | string, format?: string): string => {
      const d = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(d.getTime())) return String(date);

      if (format === 'iso') {
        return d.toISOString();
      }
      if (format === 'time') {
        return d.toLocaleTimeString();
      }
      if (format === 'datetime') {
        return d.toLocaleString();
      }
      // Default: localized date
      return d.toLocaleDateString();
    },

    /**
     * Format a number as currency
     */
    formatCurrency: (amount: number, currency = 'USD'): string => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);
    },

    /**
     * Generate a unique ID for DOM elements
     */
    uniqueId: (prefix = 'mcp'): string => {
      return `${prefix}-${++idCounter}-${Date.now().toString(36)}`;
    },

    /**
     * Safely embed JSON data in HTML
     * Escapes characters that could break out of script tags or HTML
     */
    jsonEmbed: (data: unknown): string => {
      // JSON.stringify returns undefined for undefined input, handle it
      const json = JSON.stringify(data);
      if (json === undefined) {
        return 'undefined';
      }
      return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/'/g, '\\u0027');
    },
  };
}

// ============================================
// Main Wrapper Function
// ============================================

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
export function wrapToolUI(options: WrapToolUIFullOptions): string {
  const {
    content,
    toolName,
    input = {},
    output,
    structuredContent,
    csp,
    widgetAccessible = false,
    title,
    theme: themeOverrides,
    platform = OPENAI_PLATFORM,
    hostContext,
    sanitizeInput: sanitizeOption,
    rendererType,
    hydrate = false, // Disabled by default to prevent React hydration Error #418 in MCP clients
    skipCspMeta = false,
  } = options;

  // Apply input sanitization if enabled
  let sanitizedInput = input;
  if (sanitizeOption) {
    const sanitizeMode = sanitizeOption === true ? true : sanitizeOption;
    sanitizedInput = sanitizeInputFn(input, sanitizeMode);
  }

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Check CDN capabilities
  const useCdn = canUseCdn(platform);
  const useInline = needsInlineScripts(platform);

  // Build font links (skip for blocked network)
  const fontPreconnect = useCdn ? buildFontPreconnect() : '';
  const fontStylesheets = useCdn ? buildFontStylesheets({ inter: true }) : '';

  // Build scripts (Tailwind only - no HTMX needed for basic widgets)
  const scripts = buildCdnScripts({
    tailwind: platform.supportsTailwind,
    htmx: false,
    alpine: false,
    icons: false,
    inline: useInline,
  });

  // Build framework runtime scripts (React/MDX)
  const frameworkScripts = buildFrameworkRuntimeScripts({
    rendererType,
    hydrate,
    platform,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = platform.supportsTailwind
    ? `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`
    : '';

  // Build CSP meta tag (skip for platforms like OpenAI that handle CSP via _meta)
  const cspMetaTag = skipCspMeta ? '' : buildCSPMetaTag(csp);

  // Build data injection script
  const dataScript = buildDataInjectionScript({
    toolName,
    input: sanitizedInput,
    output,
    structuredContent,
    widgetAccessible,
    hostContext,
  });

  // Page title
  const pageTitle = title || `${escapeHtml(toolName)} - Tool Result`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${cspMetaTag}

  <!-- Fonts -->
  ${fontPreconnect}
  ${fontStylesheets}

  <!-- Tailwind CSS -->
  ${scripts}
  ${styleBlock}

  <!-- Framework Runtime -->
  ${frameworkScripts}

  <!-- Tool Data -->
  ${dataScript}

  <!-- MCP Bridge Runtime -->
  ${MCP_BRIDGE_RUNTIME}
</head>
<body class="bg-background text-text-primary font-sans antialiased">
  ${content}
</body>
</html>`;
}

/**
 * Build framework-specific runtime scripts (React, MDX).
 * Only included when using React/MDX renderers with hydration enabled.
 */
function buildFrameworkRuntimeScripts(options: {
  rendererType?: string;
  hydrate?: boolean;
  platform: PlatformCapabilities;
}): string {
  const { rendererType, hydrate, platform } = options;

  // No framework scripts needed for HTML templates
  if (!rendererType || rendererType === 'html' || rendererType === 'html-fallback') {
    return '';
  }

  // Only include runtime if hydration is enabled
  if (!hydrate) {
    return '';
  }

  // React/MDX both need React runtime for hydration
  if (rendererType === 'react' || rendererType === 'mdx') {
    const useCdn = canUseCdn(platform);

    if (useCdn) {
      // Use CDN for platforms with network access
      return `
  <!-- React Runtime (for hydration) -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script>
    // Hydration script for React/MDX components
    (function() {
      document.addEventListener('DOMContentLoaded', function() {
        var hydratables = document.querySelectorAll('[data-hydrate], [data-mdx-hydrate]');
        if (hydratables.length > 0 && window.__frontmcp_components) {
          hydratables.forEach(function(el) {
            var componentName = el.getAttribute('data-hydrate');
            var propsJson = el.getAttribute('data-props');
            var props = propsJson ? JSON.parse(propsJson) : {};

            if (window.__frontmcp_components[componentName]) {
              try {
                ReactDOM.hydrateRoot(el, React.createElement(
                  window.__frontmcp_components[componentName],
                  props
                ));
              } catch (e) {
                console.error('[FrontMCP] Hydration failed:', e);
              }
            }
          });
        }
      });
    })();
  </script>`;
    } else {
      // For blocked-network platforms, SSR only (no hydration)
      return `
  <!-- React hydration not available on blocked-network platforms -->
  <script>
    console.warn('[FrontMCP] React hydration disabled - platform does not support external scripts');
  </script>`;
    }
  }

  return '';
}

/**
 * Build the data injection script that sets up globals before MCP Bridge runs
 */
function buildDataInjectionScript(options: {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  structuredContent?: unknown;
  widgetAccessible: boolean;
  hostContext?: Partial<HostContext>;
}): string {
  const { toolName, input, output, structuredContent, widgetAccessible, hostContext } = options;

  const helpers = createTemplateHelpers();

  // Build the context object
  const contextData = {
    theme: hostContext?.theme || 'light',
    displayMode: hostContext?.displayMode || 'inline',
    ...hostContext,
  };

  return `<script>
  // Tool metadata
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpToolInput = ${helpers.jsonEmbed(input)};
  window.__mcpToolOutput = ${helpers.jsonEmbed(output)};
  window.__mcpStructuredContent = ${helpers.jsonEmbed(structuredContent)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(widgetAccessible)};
  window.__mcpHostContext = ${helpers.jsonEmbed(contextData)};
</script>`;
}

// ============================================
// Universal Wrapper (Works on All Platforms)
// ============================================

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
export function wrapToolUIUniversal(options: WrapToolUIUniversalOptions): string {
  const {
    content,
    toolName,
    input = {},
    output,
    structuredContent,
    csp,
    widgetAccessible = false,
    title,
    theme: themeOverrides,
    includeBridge = true,
    inlineScripts = false,
    rendererType,
    hydrate = false, // Disabled by default to prevent React hydration Error #418 in MCP clients
    skipCspMeta = false,
    resourceMode = inlineScripts ? 'inline' : 'cdn',
  } = options;

  // Determine if we should use inline scripts based on resourceMode
  const useInlineScripts = resourceMode === 'inline' || inlineScripts;

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Build font links (skip for inline mode / blocked network)
  const fontPreconnect = useInlineScripts ? '' : buildFontPreconnect();
  const fontStylesheets = useInlineScripts ? '' : buildFontStylesheets({ inter: true });

  // Build CDN scripts
  const scripts = buildCdnScripts({
    tailwind: true,
    htmx: false,
    alpine: false,
    icons: false,
    inline: useInlineScripts,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`;

  // Build CSP meta tag (skip for platforms like OpenAI that handle CSP via _meta)
  const cspMetaTag = skipCspMeta ? '' : buildCSPMetaTag(csp);

  // Build data injection script
  const dataScript = buildDataInjectionScript({
    toolName,
    input,
    output,
    structuredContent,
    widgetAccessible,
  });

  // Build framework runtime (for React/MDX hydration)
  // When resourceMode is 'cdn', we use CDN URLs for React/ReactDOM
  const frameworkScripts = buildFrameworkRuntimeScriptsUniversal({
    rendererType,
    hydrate,
    inlineScripts: useInlineScripts,
    resourceMode,
  });

  // Universal bridge script (works on all platforms)
  const bridgeScript = includeBridge ? BRIDGE_SCRIPT_TAGS.universal : '';

  // Page title
  const pageTitle = title || `${escapeHtml(toolName)} - Tool Result`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${cspMetaTag}

  <!-- Fonts -->
  ${fontPreconnect}
  ${fontStylesheets}

  <!-- Tailwind CSS -->
  ${scripts}
  ${styleBlock}

  <!-- Framework Runtime -->
  ${frameworkScripts}

  <!-- Tool Data -->
  ${dataScript}

  <!-- FrontMCP Bridge (Universal - Auto-detects host platform) -->
  ${bridgeScript}
</head>
<body class="bg-background text-text-primary font-sans antialiased">
  ${content}
</body>
</html>`;
}

/**
 * Build framework runtime scripts for universal wrapper.
 * Supports both CDN mode (lightweight URLs) and inline mode (embedded scripts).
 */
function buildFrameworkRuntimeScriptsUniversal(options: {
  rendererType?: string;
  hydrate?: boolean;
  inlineScripts?: boolean;
  resourceMode?: ResourceMode;
}): string {
  const { rendererType, hydrate, inlineScripts, resourceMode = 'cdn' } = options;

  // No framework scripts needed for HTML templates
  if (!rendererType || rendererType === 'html' || rendererType === 'html-fallback') {
    return '';
  }

  // Determine if we're using inline scripts
  const useInline = resourceMode === 'inline' || inlineScripts;

  // React/MDX both need React runtime
  // Include scripts when:
  // 1. Using CDN mode (resourceMode === 'cdn') - scripts are lightweight
  // 2. Hydration is enabled (for client-side interaction)
  if (rendererType === 'react' || rendererType === 'mdx') {
    if (!useInline) {
      // CDN mode: Use ES modules from esm.sh for React 19
      const reactScripts = `
  <!-- React 19 Runtime (ES modules from esm.sh) -->
  <script type="module">
    import React from 'https://esm.sh/react@19';
    import { createRoot } from 'https://esm.sh/react-dom@19/client';
    window.React = React;
    window.ReactDOM = { createRoot };
  </script>`;

      // Add MDX runtime if needed
      const mdxScripts =
        rendererType === 'mdx'
          ? `
  <!-- MDX Runtime (CDN mode) -->
  <script type="module">
    import * as runtime from 'https://esm.sh/@mdx-js/react@3?bundle';
    window.MDXRuntime = runtime;
  </script>`
          : '';

      // Add hydration script if hydration is enabled
      const hydrationScript = hydrate
        ? `
  <script>
    // Hydration script for React/MDX components
    (function() {
      document.addEventListener('DOMContentLoaded', function() {
        var hydratables = document.querySelectorAll('[data-hydrate], [data-mdx-hydrate]');
        if (hydratables.length > 0 && window.__frontmcp_components) {
          hydratables.forEach(function(el) {
            var componentName = el.getAttribute('data-hydrate');
            var propsJson = el.getAttribute('data-props');
            var props = propsJson ? JSON.parse(propsJson) : {};

            if (window.__frontmcp_components[componentName]) {
              try {
                ReactDOM.hydrateRoot(el, React.createElement(
                  window.__frontmcp_components[componentName],
                  props
                ));
              } catch (e) {
                console.error('[FrontMCP] Hydration failed:', e);
              }
            }
          });
        }
      });
    })();
  </script>`
        : '';

      return reactScripts + mdxScripts + hydrationScript;
    } else {
      // Inline mode: Scripts must be embedded in HTML (for blocked-network environments)
      // Currently not implemented - would require fetching and caching React at build time
      return `
  <!-- React/MDX runtime disabled (inline/blocked-network mode) -->
  <script>
    console.warn('[FrontMCP] React/MDX runtime disabled - inline scripts mode (network blocked). SSR content is static.');
  </script>`;
    }
  }

  return '';
}

// ============================================
// Minimal Wrapper (No Theme)
// ============================================

/**
 * Wrap tool UI content with minimal boilerplate.
 * Use this when you need to control all styling yourself.
 *
 * @param options - Minimal wrapper options
 * @returns HTML document string
 */
export function wrapToolUIMinimal(
  options: Pick<
    WrapToolUIOptions,
    'content' | 'toolName' | 'input' | 'output' | 'structuredContent' | 'csp' | 'widgetAccessible' | 'title'
  > & { skipCspMeta?: boolean },
): string {
  const {
    content,
    toolName,
    input = {},
    output,
    structuredContent,
    csp,
    widgetAccessible = false,
    title,
    skipCspMeta = false,
  } = options;

  const helpers = createTemplateHelpers();

  // Build CSP meta tag (skip for platforms like OpenAI that handle CSP via _meta)
  const cspMetaTag = skipCspMeta ? '' : buildCSPMetaTag(csp);

  // Build data injection
  const contextData = { theme: 'light', displayMode: 'inline' };

  const dataScript = `<script>
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpToolInput = ${helpers.jsonEmbed(input)};
  window.__mcpToolOutput = ${helpers.jsonEmbed(output)};
  window.__mcpStructuredContent = ${helpers.jsonEmbed(structuredContent)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(widgetAccessible)};
  window.__mcpHostContext = ${helpers.jsonEmbed(contextData)};
</script>`;

  const pageTitle = title || `${escapeHtml(toolName)} - Tool Result`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${cspMetaTag}
  ${dataScript}
  ${MCP_BRIDGE_RUNTIME}
</head>
<body>
  ${content}
</body>
</html>`;
}

// ============================================
// Static Widget Wrapper (For MCP Resource Mode)
// ============================================

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
  uiConfig: { widgetAccessible?: boolean };
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
export function wrapLeanWidgetShell(options: WrapLeanWidgetShellOptions): string {
  const { toolName, uiConfig, title, theme: themeOverrides } = options;

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Build font links
  const fontPreconnect = buildFontPreconnect();
  const fontStylesheets = buildFontStylesheets({ inter: true });

  // Build CDN scripts (only Tailwind for styling)
  const tailwindScript = buildCdnScripts({
    tailwind: true,
    htmx: false,
    alpine: false,
    icons: false,
    inline: false,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`;

  // Placeholder content with loading indicator
  const placeholderContent = `
    <div id="frontmcp-widget-root" class="flex items-center justify-center min-h-[200px] p-4">
      <div class="text-center text-gray-500">
        <svg class="animate-spin mx-auto mb-2" style="width: 1.5rem; height: 1.5rem; color: #9ca3af;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm">Loading widget...</p>
      </div>
    </div>
  `;

  // Tool metadata script
  const toolMetaScript = `<script>
  // Lean widget shell for inline mode
  // Actual widget content comes in tool response via ui/html
  window.__mcpToolName = ${JSON.stringify(toolName)};
  window.__mcpWidgetAccessible = ${JSON.stringify(uiConfig.widgetAccessible ?? false)};
  window.__mcpLeanShell = true;
</script>`;

  // FrontMCP Bridge script (platform-agnostic)
  const bridgeScript = BRIDGE_SCRIPT_TAGS.universal;

  // Injector script that uses the bridge to detect and inject ui/html
  const injectorScript = `<script>
  // Lean shell injector for inline mode
  // Uses FrontMCP Bridge (platform-agnostic) to detect tool response HTML
  (function() {
    var injected = false;

    function injectWidget(metadata) {
      if (injected) return;

      // Check for ui/html in metadata
      var html = null;

      if (metadata) {
        // Try different possible locations for the HTML
        html = metadata['ui/html'] || metadata['openai/html'] || metadata.html;
      }

      if (html && typeof html === 'string') {
        injected = true;
        console.log('[FrontMCP] Lean shell: Injecting inline widget HTML (' + html.length + ' chars)');

        // Replace entire document with the full React widget HTML
        document.open();
        document.write(html);
        document.close();
        return true;
      }
      return false;
    }

    // Wait for bridge to be ready, then subscribe
    function subscribeAndInject() {
      var bridge = window.FrontMcpBridge;
      if (!bridge) {
        console.warn('[FrontMCP] Lean shell: Bridge not found');
        return;
      }

      // Check if data already available (via getToolResponseMetadata)
      if (typeof bridge.getToolResponseMetadata === 'function') {
        var existing = bridge.getToolResponseMetadata();
        if (existing && injectWidget(existing)) {
          return; // Already injected
        }
      }

      // Subscribe to metadata changes (via onToolResponseMetadata)
      if (typeof bridge.onToolResponseMetadata === 'function') {
        console.log('[FrontMCP] Lean shell: Subscribing to tool response metadata');
        bridge.onToolResponseMetadata(function(metadata) {
          console.log('[FrontMCP] Lean shell: Received tool response metadata');
          injectWidget(metadata);
        });
      } else {
        console.warn('[FrontMCP] Lean shell: onToolResponseMetadata not available on bridge');
      }
    }

    // Wait for bridge:ready event
    window.addEventListener('bridge:ready', function() {
      console.log('[FrontMCP] Lean shell: Bridge ready, setting up injector');
      subscribeAndInject();
    });

    // Also try immediately in case bridge is already ready
    if (window.FrontMcpBridge && window.FrontMcpBridge.initialized) {
      subscribeAndInject();
    }

    // Fallback: poll for bridge if event doesn't fire
    var bridgeCheckAttempts = 0;
    var bridgeCheckInterval = setInterval(function() {
      bridgeCheckAttempts++;
      if (window.FrontMcpBridge) {
        clearInterval(bridgeCheckInterval);
        if (!injected) {
          subscribeAndInject();
        }
      } else if (bridgeCheckAttempts >= 100) {
        // 10 second timeout
        clearInterval(bridgeCheckInterval);
        console.warn('[FrontMCP] Lean shell: Timeout waiting for bridge');
      }
    }, 100);
  })();
</script>`;

  // Spinner animation CSS
  const spinnerCss = `<style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
  </style>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || toolName)}</title>
  ${fontPreconnect}
  ${fontStylesheets}
  ${tailwindScript}
  ${styleBlock}
  ${spinnerCss}
  ${toolMetaScript}
  ${bridgeScript}
</head>
<body class="bg-white font-sans antialiased">
  ${placeholderContent}
  ${injectorScript}
</body>
</html>`;
}

// ============================================
// Hybrid Widget Shell (For Hybrid Serving Mode)
// ============================================

/**
 * Options for hybrid widget shell (hybrid mode resourceTemplate).
 */
export interface WrapHybridWidgetShellOptions {
  /** Tool name */
  toolName: string;
  /** UI configuration */
  uiConfig: { widgetAccessible?: boolean; csp?: WrapToolUIOptions['csp'] };
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
export function wrapHybridWidgetShell(options: WrapHybridWidgetShellOptions): string {
  const { toolName, uiConfig, title, theme: themeOverrides } = options;

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Build font links
  const fontPreconnect = buildFontPreconnect();
  const fontStylesheets = buildFontStylesheets({ inter: true });

  // Build CDN scripts (Tailwind for styling)
  const tailwindScript = buildCdnScripts({
    tailwind: true,
    htmx: false,
    alpine: false,
    icons: false,
    inline: false,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`;

  // Loading placeholder content
  const placeholderContent = `
    <div id="frontmcp-widget-root" class="flex items-center justify-center min-h-[200px] p-4">
      <div class="text-center text-gray-500">
        <svg class="animate-spin mx-auto mb-2" style="width: 1.5rem; height: 1.5rem; color: #9ca3af;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm">Loading widget...</p>
      </div>
    </div>
    <div id="frontmcp-error" style="display: none; padding: 1rem; margin: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; color: #dc2626; font-size: 0.875rem;"></div>
  `;

  // Tool metadata script
  const toolMetaScript = `<script>
  // Hybrid widget shell - component comes at tool call time
  window.__mcpToolName = ${JSON.stringify(toolName)};
  window.__mcpWidgetAccessible = ${JSON.stringify(uiConfig.widgetAccessible ?? false)};
  window.__mcpHybridShell = true;
</script>`;

  // FrontMCP Bridge script (platform-agnostic)
  const bridgeScript = BRIDGE_SCRIPT_TAGS.universal;

  // Spinner animation CSS
  const spinnerCss = `<style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
  </style>`;

  // React 19 runtime + FrontMCP hooks + UI components + dynamic renderer
  // This is the key script that makes hybrid mode work
  const hybridRuntimeScript = `
  <!-- FrontMCP Hybrid Widget Runtime -->
  <script type="module">
  // ============================================
  // 1. Import React 19 from esm.sh
  // ============================================
  import React from 'https://esm.sh/react@19';
  import ReactDOM from 'https://esm.sh/react-dom@19/client';

  // Make React available globally
  window.React = React;
  window.ReactDOM = ReactDOM;

  // ============================================
  // 2. Provide webpack namespace objects for transpiled components
  // ============================================
  window.external_react_namespaceObject = React;
  window.jsx_runtime_namespaceObject = {
    jsx: (type, props, key) => {
      if (key !== undefined) props = { ...props, key };
      return React.createElement(type, props);
    },
    jsxs: (type, props, key) => {
      if (key !== undefined) props = { ...props, key };
      return React.createElement(type, props);
    },
    Fragment: React.Fragment,
  };
  window.process = window.process || { env: { NODE_ENV: 'production' } };

  // ============================================
  // 3. FrontMCP Hooks (platform-agnostic via bridge)
  // ============================================
  function useMcpBridgeContext() {
    return {
      bridge: window.FrontMcpBridge || null,
      loading: false,
      error: null,
      ready: window.FrontMcpBridge?.initialized ?? false,
      adapterId: window.FrontMcpBridge?.adapterId ?? 'unknown',
      capabilities: window.FrontMcpBridge?.capabilities ?? {},
    };
  }

  function useToolOutput() {
    const [output, setOutput] = React.useState(null);
    React.useEffect(() => {
      const bridge = window.FrontMcpBridge;
      if (!bridge) return;

      // Get initial output
      const initial = bridge.getToolOutput();
      if (initial) setOutput(initial);

      // Subscribe to updates
      const unsubscribe = bridge.onToolResult((result) => {
        setOutput(result);
      });
      return unsubscribe;
    }, []);
    return output;
  }

  function useToolInput() {
    const bridge = window.FrontMcpBridge;
    return bridge?.getToolInput() || window.__mcpToolInput || {};
  }

  function useTheme() {
    const [theme, setTheme] = React.useState('light');
    React.useEffect(() => {
      const bridge = window.FrontMcpBridge;
      if (bridge?.getTheme) setTheme(bridge.getTheme());
    }, []);
    return theme;
  }

  function useCallTool(toolName, options = {}) {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const isAvailable = !!(
      (window.openai && typeof window.openai.callTool === 'function') ||
      (window.FrontMcpBridge && window.FrontMcpBridge.hasCapability('canCallTools'))
    );

    const callTool = React.useCallback(async (args) => {
      setLoading(true);
      setError(null);
      try {
        let result;
        if (window.openai && typeof window.openai.callTool === 'function') {
          result = await window.openai.callTool(toolName, args || {});
        } else if (window.FrontMcpBridge) {
          result = await window.FrontMcpBridge.callTool(toolName, args || {});
        } else {
          throw new Error('Tool calling not available');
        }
        options.onSuccess?.(result);
        return result;
      } catch (err) {
        setError(err);
        options.onError?.(err);
        throw err;
      } finally {
        setLoading(false);
      }
    }, [toolName]);

    return [callTool, { loading, error, available: isAvailable }];
  }

  // ============================================
  // 4. FrontMCP UI Components
  // ============================================
  function Card({ title, subtitle, variant, size, className, children, footer }) {
    const baseClasses = 'rounded-lg border bg-bg-surface';
    const variantClasses = variant === 'elevated' ? 'shadow-md' : 'border-divider';
    const sizeClasses = { sm: 'p-3', md: 'p-4', lg: 'p-6' }[size || 'md'];
    return React.createElement('div', { className: [baseClasses, variantClasses, sizeClasses, className].filter(Boolean).join(' ') },
      (title || subtitle) && React.createElement('div', { className: 'mb-4' },
        title && React.createElement('h3', { className: 'text-lg font-semibold text-text-primary' }, title),
        subtitle && React.createElement('p', { className: 'text-sm text-text-secondary mt-1' }, subtitle)
      ),
      children,
      footer && React.createElement('div', { className: 'mt-4 pt-4 border-t border-divider' }, footer)
    );
  }

  function Badge({ children, variant, size, pill }) {
    const baseClasses = 'inline-flex items-center font-medium';
    const variantClasses = {
      default: 'bg-bg-secondary text-text-primary',
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      info: 'bg-blue-100 text-blue-800',
      danger: 'bg-red-100 text-red-800',
    }[variant || 'default'];
    const sizeClasses = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-sm', lg: 'px-3 py-1.5 text-base' }[size || 'md'];
    const pillClasses = pill ? 'rounded-full' : 'rounded-md';
    return React.createElement('span', {
      className: [baseClasses, variantClasses, sizeClasses, pillClasses].filter(Boolean).join(' ')
    }, children);
  }

  function Button({ children, variant, size, disabled, onClick, className }) {
    const baseClasses = 'inline-flex items-center justify-center rounded-md font-medium transition-colors';
    const variantClasses = {
      primary: 'bg-primary text-white hover:bg-primary/90',
      secondary: 'bg-bg-secondary text-text-primary hover:bg-bg-secondary/80',
      outline: 'border border-divider bg-transparent hover:bg-bg-secondary',
      ghost: 'bg-transparent hover:bg-bg-secondary',
    }[variant || 'primary'];
    const sizeClasses = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-base', lg: 'px-6 py-3 text-lg' }[size || 'md'];
    const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';
    return React.createElement('button', {
      type: 'button',
      className: [baseClasses, variantClasses, sizeClasses, disabledClasses, className].filter(Boolean).join(' '),
      disabled,
      onClick,
    }, children);
  }

  // Expose via react_namespaceObject for transpiled components
  window.react_namespaceObject = {
    ...React,
    useMcpBridgeContext,
    useToolOutput,
    useToolInput,
    useTheme,
    useCallTool,
    Card,
    Badge,
    Button,
    McpBridgeProvider: ({ children }) => children,
  };
  window.react_dom_namespaceObject = ReactDOM;

  // Template helpers
  window.__frontmcp_helpers = {
    escapeHtml: (str) => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c] || c),
    formatDate: (d) => new Date(d).toLocaleDateString(),
    formatCurrency: (a, c) => new Intl.NumberFormat('en-US', {style:'currency',currency:c||'USD'}).format(a),
  };

  // Component-specific helpers (for weather demo, etc.)
  window.iconMap = {
    sunny: '\\u2600\\uFE0F', cloudy: '\\u2601\\uFE0F', rainy: '\\uD83C\\uDF27\\uFE0F',
    snowy: '\\u2744\\uFE0F', stormy: '\\u26C8\\uFE0F', windy: '\\uD83D\\uDCA8', foggy: '\\uD83C\\uDF2B\\uFE0F',
  };
  window.getConditionBadgeVariant = function(c) {
    switch(c) { case 'sunny': return 'success'; case 'rainy': case 'snowy': return 'info'; case 'stormy': return 'warning'; default: return 'default'; }
  };

  console.log('[FrontMCP Hybrid] React 19 runtime loaded with hooks and components');

  // ============================================
  // 5. Dynamic Renderer
  // ============================================
  let currentComponent = null;
  let reactRoot = null;

  function hideLoader() {
    const loader = document.querySelector('#frontmcp-widget-root > div');
    if (loader) loader.style.display = 'none';
  }

  function showError(message) {
    const errorEl = document.getElementById('frontmcp-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
    hideLoader();
  }

  function render() {
    const bridge = window.FrontMcpBridge;
    const output = bridge?.getToolOutput();

    if (!currentComponent) {
      console.log('[FrontMCP Hybrid] No component loaded yet');
      return false;
    }

    if (!output) {
      console.log('[FrontMCP Hybrid] No data available yet');
      return false;
    }

    const root = document.getElementById('frontmcp-widget-root');
    if (!root) return false;

    const props = {
      input: bridge.getToolInput() || {},
      output: output,
      structuredContent: bridge.getStructuredContent(),
      helpers: window.__frontmcp_helpers,
    };

    try {
      hideLoader();
      const element = React.createElement(currentComponent, props);
      if (!reactRoot) {
        reactRoot = ReactDOM.createRoot(root);
      }
      reactRoot.render(element);
      console.log('[FrontMCP Hybrid] Component rendered with data');
      return true;
    } catch (err) {
      console.error('[FrontMCP Hybrid] Render failed:', err);
      showError('Rendering failed: ' + err.message);
      return false;
    }
  }

  async function loadComponent(payload) {
    if (!payload?.code) {
      console.warn('[FrontMCP Hybrid] No component code in payload');
      return;
    }

    console.log('[FrontMCP Hybrid] Loading component, type:', payload.type);

    try {
      // Import component via blob URL
      const blob = new Blob([payload.code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      const module = await import(/* webpackIgnore: true */ url);
      currentComponent = module.default || window.__frontmcp_component;
      URL.revokeObjectURL(url);

      if (!currentComponent) {
        throw new Error('Component not found in module');
      }

      console.log('[FrontMCP Hybrid] Component loaded successfully');
      render();
    } catch (err) {
      console.error('[FrontMCP Hybrid] Failed to load component:', err);
      showError('Failed to load component: ' + err.message);
    }
  }

  // ============================================
  // 6. Bridge Integration
  // ============================================
  async function initializeBridge() {
    // Wait for bridge to be ready
    if (!window.FrontMcpBridge?.initialized) {
      await new Promise(resolve => {
        window.addEventListener('bridge:ready', resolve, { once: true });
        // Fallback timeout
        setTimeout(resolve, 5000);
      });
    }

    const bridge = window.FrontMcpBridge;
    if (!bridge) {
      console.error('[FrontMCP Hybrid] Bridge not available');
      showError('Bridge initialization failed');
      return;
    }

    console.log('[FrontMCP Hybrid] Bridge ready, adapter:', bridge.adapterId);

    // Listen for component code in tool response metadata
    if (typeof bridge.onToolResponseMetadata === 'function') {
      bridge.onToolResponseMetadata(function(metadata) {
        console.log('[FrontMCP Hybrid] Received tool response metadata');

        // Check for component payload
        const componentPayload = metadata['ui/component'];
        if (componentPayload) {
          loadComponent(componentPayload);
        }
      });
    }

    // Listen for data updates (for re-renders)
    if (typeof bridge.onToolResult === 'function') {
      bridge.onToolResult(function(result) {
        console.log('[FrontMCP Hybrid] Received tool result update');
        render();
      });
    }

    // Check if data already available (e.g., page refresh)
    const existingMetadata = bridge.getToolResponseMetadata?.();
    if (existingMetadata?.['ui/component']) {
      loadComponent(existingMetadata['ui/component']);
    }
  }

  // Start initialization
  initializeBridge();
  </script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || toolName)}</title>
  ${fontPreconnect}
  ${fontStylesheets}
  ${tailwindScript}
  ${styleBlock}
  ${spinnerCss}
  ${toolMetaScript}
  ${bridgeScript}
</head>
<body class="bg-white font-sans antialiased">
  ${placeholderContent}
  ${hybridRuntimeScript}
</body>
</html>`;
}

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
export function wrapStaticWidgetUniversal(options: WrapStaticWidgetOptions): string {
  const {
    toolName,
    ssrContent,
    uiConfig,
    title,
    theme: themeOverrides,
    rendererType,
    componentCode,
    embeddedData,
    selfContained = false,
  } = options;

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Build font links
  const fontPreconnect = buildFontPreconnect();
  const fontStylesheets = buildFontStylesheets({ inter: true });

  // Build CDN scripts
  const scripts = buildCdnScripts({
    tailwind: true,
    htmx: false,
    alpine: false,
    icons: false,
    inline: false,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`;

  // Build CSP meta tag (skip for OpenAI - they handle CSP via _meta)
  // For static widgets, we skip CSP meta tag since OpenAI handles it
  const cspMetaTag = '';

  const isReactBased = rendererType === 'react' || rendererType === 'mdx';

  // For inline mode with embeddedData: embed the data directly in the HTML
  // For static mode (no embeddedData): data comes from window.openai.toolOutput at runtime
  const hasEmbeddedData = embeddedData && (embeddedData.output !== undefined || embeddedData.input !== undefined);

  // Universal bridge script (works on all platforms)
  // Skip for self-contained/inline mode - data is embedded, no runtime communication needed
  // Including the bridge triggers OpenAI's wrapper script which destroys our React content
  // selfContained mode: explicitly skip bridge (inline mode with full React)
  // hasEmbeddedData: backward compatibility for inline mode detection
  const includeBridge = !selfContained && !hasEmbeddedData;
  const bridgeScript = includeBridge ? BRIDGE_SCRIPT_TAGS.universal : '';

  // Tool name injection (for Bridge to know which tool this is)
  const helpers = createTemplateHelpers();

  // Build the tool metadata script based on mode
  // selfContained: inline mode with no bridge - React manages its own state
  // hasEmbeddedData: backward compat - inline mode with embedded data
  // neither: static mode - polls for data from host platform
  const toolNameScript =
    selfContained && hasEmbeddedData
      ? `<script>
  // Tool metadata (self-contained inline mode - no bridge, no wrapper interference)
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(uiConfig.widgetAccessible ?? false)};
  // Embedded data for immediate rendering
  window.__mcpToolInput = ${helpers.jsonEmbed(embeddedData.input ?? {})};
  window.__mcpToolOutput = ${helpers.jsonEmbed(embeddedData.output)};
  window.__mcpStructuredContent = ${helpers.jsonEmbed(embeddedData.structuredContent)};
  // Flags for self-contained mode
  window.__mcpDataEmbedded = true;
  window.__mcpSelfContained = true;
  // No bridge included - React component handles state internally via hooks
</script>`
      : hasEmbeddedData
        ? `<script>
  // Tool metadata (inline mode - data embedded, backward compat)
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(uiConfig.widgetAccessible ?? false)};
  window.__mcpToolInput = ${helpers.jsonEmbed(embeddedData.input ?? {})};
  window.__mcpToolOutput = ${helpers.jsonEmbed(embeddedData.output)};
  window.__mcpStructuredContent = ${helpers.jsonEmbed(embeddedData.structuredContent)};
  window.__mcpDataEmbedded = true;
</script>`
        : `<script>
  // Tool metadata (static mode - data injected by host at runtime)
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(uiConfig.widgetAccessible ?? false)};
  // Data will be provided by host platform:
  // - OpenAI: window.openai.toolOutput
  // - FrontMCP Bridge: window.__mcpToolOutput, window.__mcpStructuredContent
</script>`;

  // Build the consolidated React module script
  // Everything runs inside a single ES module for better async/import handling
  const reactModuleScript =
    isReactBased && componentCode
      ? `
  <!-- FrontMCP React Widget Runtime (Single ES Module) -->
  <script type="module">
  // ============================================
  // 1. Import React 19 from esm.sh
  // ============================================
  import React from 'https://esm.sh/react@19';
  import ReactDOM from 'https://esm.sh/react-dom@19/client';

  // Make React available globally for the component code
  window.React = React;
  window.ReactDOM = ReactDOM;

  // ============================================
  // 1b. Provide ALL webpack namespace objects
  // ============================================
  // Webpack generates different namespace variable names when bundling:
  // - external_react_namespaceObject: React marked as external
  // - jsx_runtime_namespaceObject: react/jsx-runtime
  // We must provide ALL of these for transpiled components to work.

  // external_react_namespaceObject - for React imports (useState, useEffect, etc.)
  window.external_react_namespaceObject = React;

  // jsx_runtime_namespaceObject - for JSX transformation (jsx, jsxs functions)
  window.jsx_runtime_namespaceObject = {
    jsx: (type, props, key) => {
      if (key !== undefined) props = { ...props, key };
      return React.createElement(type, props);
    },
    jsxs: (type, props, key) => {
      if (key !== undefined) props = { ...props, key };
      return React.createElement(type, props);
    },
    Fragment: React.Fragment,
  };

  // process.env - for development mode checks
  window.process = window.process || { env: { NODE_ENV: 'production' } };

  // ============================================
  // 1c. Component-specific helpers
  // ============================================
  // These are module-level variables that get lost when calling .toString() on the component.
  // For the weather component, we need iconMap and getConditionBadgeVariant.

  window.iconMap = {
    sunny: '\u2600\uFE0F',
    cloudy: '\u2601\uFE0F',
    rainy: '\uD83C\uDF27\uFE0F',
    snowy: '\u2744\uFE0F',
    stormy: '\u26C8\uFE0F',
    windy: '\uD83D\uDCA8',
    foggy: '\uD83C\uDF2B\uFE0F',
  };

  window.getConditionBadgeVariant = function(conditions) {
    switch (conditions) {
      case 'sunny': return 'success';
      case 'rainy':
      case 'snowy': return 'info';
      case 'stormy': return 'warning';
      default: return 'default';
    }
  };

  // ============================================
  // 2. Provide FrontMCP hooks on the react namespace
  // ============================================
  // Transpiled components may call react_namespaceObject.useMcpBridgeContext, etc.
  // These are FrontMCP hooks that get bundled with React imports.
  // We provide stub implementations that work with the client-side data.

  // State storage for hooks
  const hookState = {
    toolOutput: null,
    toolInput: null,
    theme: 'light',
    ready: false,
  };

  // useMcpBridgeContext - returns context about the bridge
  function useMcpBridgeContext() {
    return {
      bridge: window.__frontmcp?.bridge || null,
      loading: false,
      error: null,
      ready: hookState.ready,
      adapterId: 'openai',
      capabilities: { canCallTools: true, canSendMessages: false },
    };
  }

  // useToolOutput - returns the tool output
  function useToolOutput() {
    const [output, setOutput] = React.useState(hookState.toolOutput);
    React.useEffect(() => {
      // Update when toolOutput changes
      const checkOutput = () => {
        const newOutput = getToolOutput();
        if (newOutput && newOutput !== output) {
          setOutput(newOutput);
          hookState.toolOutput = newOutput;
        }
      };
      const interval = setInterval(checkOutput, 100);
      checkOutput();
      return () => clearInterval(interval);
    }, []);
    return output;
  }

  // useToolInput - returns the tool input
  function useToolInput() {
    return hookState.toolInput || window.__mcpToolInput || {};
  }

  // useTheme - returns current theme
  function useTheme() {
    const [theme, setTheme] = React.useState(hookState.theme);
    React.useEffect(() => {
      // Try to detect theme from host
      if (window.openai?.theme) {
        setTheme(window.openai.theme);
      }
    }, []);
    return theme;
  }

  // useCallTool - returns a function to call tools from within widgets
  // Supports multiple environments:
  // - OpenAI: Uses window.openai.callTool directly
  // - FrontMCP Bridge: Uses window.__frontmcp.callTool
  // - Other: Falls back gracefully
  function useCallTool(toolName, options = {}) {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    // Check availability once
    const isAvailable = !!(
      (window.openai && typeof window.openai.callTool === 'function') ||
      (window.__frontmcp && typeof window.__frontmcp.callTool === 'function')
    );

    const callTool = React.useCallback(async (args) => {
      setLoading(true);
      setError(null);
      try {
        let result;

        // Priority 1: OpenAI SDK (most reliable in OpenAI iframe)
        if (window.openai && typeof window.openai.callTool === 'function') {
          console.log('[FrontMCP] useCallTool: Using OpenAI SDK for', toolName);
          result = await window.openai.callTool(toolName, args || {});
        } else if (window.__frontmcp && typeof window.__frontmcp.callTool === 'function') {
          // Priority 2: FrontMCP bridge
          console.log('[FrontMCP] useCallTool: Using FrontMCP bridge for', toolName);
          result = await window.__frontmcp.callTool(toolName, args || {});
        } else {
          // Not available - log warning and return null
          console.warn(
            '[FrontMCP] useCallTool: No tool calling mechanism available. ' +
            'Tool: "' + toolName + '". Widget is display-only.'
          );
          const notAvailableError = new Error('Tool calling not available in this environment');
          setError(notAvailableError);
          options.onError?.(notAvailableError);
          return null;
        }

        // Normalize result: ensure structuredContent is available for component callbacks
        // OpenAI returns raw tool output directly, but components may expect { structuredContent: ... }
        // This ensures both direct access (result.temperature) and wrapped access (result.structuredContent.temperature) work
        const normalizedResult = {
          ...result,
          structuredContent: result.structuredContent ?? result,
        };

        // For static mode: Update global state so hooks (useToolOutput) pick up the change
        // For self-contained/inline mode: Skip this - React component handles state internally via setOutput
        // Updating global state in inline mode could trigger OpenAI's wrapper to overwrite our React component
        if (!window.__mcpSelfContained && !window.__mcpDataEmbedded) {
          window.__mcpToolOutput = normalizedResult.structuredContent;
          window.__mcpStructuredContent = normalizedResult.structuredContent;
        }

        console.log('[FrontMCP] useCallTool: Tool returned, normalized result:', normalizedResult);
        options.onSuccess?.(normalizedResult);
        return normalizedResult;
      } catch (err) {
        console.error('[FrontMCP] useCallTool error:', err);
        setError(err);
        options.onError?.(err);
        throw err;
      } finally {
        setLoading(false);
      }
    }, [toolName]);

    return [callTool, { loading, error, available: isAvailable }];
  }

  // ============================================
  // 2b. UI Components (Card, Badge, etc.)
  // ============================================
  // These may be bundled from @frontmcp/ui/react and referenced via namespace.
  // We provide simple stub implementations.

  function Card({ title, subtitle, variant, size, className, children, footer }) {
    const baseClasses = 'rounded-lg border bg-bg-surface';
    const variantClasses = variant === 'elevated' ? 'shadow-md' : 'border-divider';
    const sizeClasses = { sm: 'p-3', md: 'p-4', lg: 'p-6' }[size || 'md'];

    return React.createElement('div', { className: [baseClasses, variantClasses, sizeClasses, className].filter(Boolean).join(' ') },
      (title || subtitle) && React.createElement('div', { className: 'mb-4' },
        title && React.createElement('h3', { className: 'text-lg font-semibold text-text-primary' }, title),
        subtitle && React.createElement('p', { className: 'text-sm text-text-secondary mt-1' }, subtitle)
      ),
      children,
      footer && React.createElement('div', { className: 'mt-4 pt-4 border-t border-divider' }, footer)
    );
  }

  function Badge({ children, variant, size, pill }) {
    const baseClasses = 'inline-flex items-center font-medium';
    const variantClasses = {
      default: 'bg-bg-secondary text-text-primary',
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      info: 'bg-blue-100 text-blue-800',
      danger: 'bg-red-100 text-red-800',
    }[variant || 'default'];
    const sizeClasses = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-sm', lg: 'px-3 py-1.5 text-base' }[size || 'md'];
    const pillClasses = pill ? 'rounded-full' : 'rounded-md';

    return React.createElement('span', {
      className: [baseClasses, variantClasses, sizeClasses, pillClasses].filter(Boolean).join(' ')
    }, children);
  }

  function Button({ children, variant, size, disabled, onClick, className }) {
    const baseClasses = 'inline-flex items-center justify-center rounded-md font-medium transition-colors';
    const variantClasses = {
      primary: 'bg-primary text-white hover:bg-primary/90',
      secondary: 'bg-bg-secondary text-text-primary hover:bg-bg-secondary/80',
      outline: 'border border-divider bg-transparent hover:bg-bg-secondary',
      ghost: 'bg-transparent hover:bg-bg-secondary',
    }[variant || 'primary'];
    const sizeClasses = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-base', lg: 'px-6 py-3 text-lg' }[size || 'md'];
    const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

    return React.createElement('button', {
      type: 'button',
      className: [baseClasses, variantClasses, sizeClasses, disabledClasses, className].filter(Boolean).join(' '),
      disabled,
      onClick,
    }, children);
  }

  // Provide webpack-style namespace objects that transpiled components may reference
  // This fixes "react_namespaceObject is not defined" errors
  // Include both React exports AND FrontMCP hooks/components
  window.react_namespaceObject = {
    ...React,
    // FrontMCP hooks
    useMcpBridgeContext,
    useToolOutput,
    useToolInput,
    useTheme,
    useCallTool,
    // FrontMCP UI components
    Card,
    Badge,
    Button,
    // Also provide as 'McpBridgeProvider' stub (no-op for client)
    McpBridgeProvider: ({ children }) => children,
  };
  window.react_dom_namespaceObject = ReactDOM;

  console.log('[FrontMCP] React 19 loaded from esm.sh with FrontMCP hooks');

  // ============================================
  // 2. Define the Component
  // ============================================
  // Note: The component may reference react_namespaceObject which is now available
  ${componentCode}

  // ============================================
  // 3. Helper Functions
  // ============================================
  function getComponent() {
    return window.__frontmcp_component;
  }

  function getToolOutput() {
    // Try OpenAI's toolOutput first
    if (window.openai && window.openai.toolOutput) {
      return window.openai.toolOutput;
    }
    // Try FrontMCP bridge
    if (window.__mcpToolOutput) {
      return window.__mcpToolOutput;
    }
    // Try __frontmcp namespace
    if (window.__frontmcp && window.__frontmcp.toolOutput) {
      return window.__frontmcp.toolOutput;
    }
    return null;
  }

  function showLoader() {
    const loader = document.getElementById('frontmcp-loader');
    if (loader) loader.style.display = 'flex';
  }

  function hideLoader() {
    const loader = document.getElementById('frontmcp-loader');
    if (loader) loader.style.display = 'none';
  }

  function showError(message) {
    const errorEl = document.getElementById('frontmcp-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
    hideLoader();
  }

  // ============================================
  // 4. Render Function
  // ============================================
  function renderComponent() {
    const Component = getComponent();
    if (!Component) {
      console.warn('[FrontMCP] No component registered for client-side rendering');
      showError('Component not found');
      return false;
    }

    const output = getToolOutput();
    if (!output) {
      return false; // Not ready yet, keep polling
    }

    // Find or create widget root
    // OpenAI may have removed our original root element during iframe setup
    // when their wrapper script overwrites #widget-root with a loading spinner
    let root = document.getElementById('frontmcp-widget-root');
    if (!root) {
      console.log('[FrontMCP] Widget root not found, creating new element');

      // Look for OpenAI's container first - we should render inside it
      const openaiRoot = document.getElementById('widget-root');

      if (openaiRoot) {
        // Clear OpenAI's wrapper content and create our root inside
        console.log('[FrontMCP] Found OpenAI widget-root, creating frontmcp-widget-root inside it');
        openaiRoot.innerHTML = '';
        root = document.createElement('div');
        root.id = 'frontmcp-widget-root';
        openaiRoot.appendChild(root);
      } else {
        // Fallback: create in body (for MCP Inspector, etc.)
        console.log('[FrontMCP] No OpenAI widget-root, creating in body');
        root = document.createElement('div');
        root.id = 'frontmcp-widget-root';
        document.body.innerHTML = '';
        document.body.appendChild(root);
      }
    }

    // Ensure it's visible
    root.style.display = 'block';

    try {
      // Build props
      const props = {
        input: window.__mcpToolInput || {},
        output: output,
        structuredContent: window.__mcpStructuredContent,
        helpers: {
          escapeHtml: (str) => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c] || c),
          formatDate: (d) => new Date(d).toLocaleDateString(),
          formatCurrency: (a, c) => new Intl.NumberFormat('en-US', {style:'currency',currency:c||'USD'}).format(a),
        }
      };

      // Hide loader and show widget root before rendering
      hideLoader();
      root.style.display = 'block';

      // Render with React 19
      const element = React.createElement(Component, props);
      const reactRoot = ReactDOM.createRoot(root);
      reactRoot.render(element);
      console.log('[FrontMCP] Component rendered successfully with data:', output);

      // Mark React as mounted to prevent OpenAI wrapper from overwriting
      // This works with the renderContent override in the Tool Metadata script
      window.__frontmcp = window.__frontmcp || {};
      window.__frontmcp._reactMounted = true;

      // For inline mode: prevent OpenAI's wrapper from re-rendering over us
      // The wrapper subscribes to bridge state changes and will overwrite our content
      // when bridge.setData is called. We disable this after initial render.
      if (window.__mcpDataEmbedded && window.__frontmcp && window.__frontmcp.bridge) {
        window.__frontmcp._inlineRendered = true;

        // Override setData to no-op after inline render
        const originalSetData = window.__frontmcp.bridge.setData;
        if (originalSetData && !window.__frontmcp._setDataOverridden) {
          window.__frontmcp._setDataOverridden = true;
          window.__frontmcp.bridge.setData = function(data) {
            if (window.__frontmcp._inlineRendered) {
              console.log('[FrontMCP] Skipping bridge setData - inline mode already rendered');
              return;
            }
            return originalSetData.call(this, data);
          };
        }
      }

      return true;
    } catch (e) {
      console.error('[FrontMCP] React rendering failed:', e);
      showError('Rendering failed: ' + e.message);
      return false;
    }
  }

  // ============================================
  // 5. Main: Render immediately or poll for toolOutput
  // ============================================
  // For inline mode (embeddedData): data is already embedded, render immediately
  // For static mode: poll for window.openai.toolOutput

  if (window.__mcpDataEmbedded) {
    // Inline mode: Data is embedded in HTML, render immediately
    console.log('[FrontMCP] Inline mode: data embedded, rendering immediately');
    if (!renderComponent()) {
      showError('Failed to render component');
    }
  } else {
    // MCP-resource mode: Poll for toolOutput from host platform
    showLoader();

    let attempts = 0;
    const maxAttempts = 100; // 10 seconds max
    const pollInterval = setInterval(() => {
      attempts++;
      if (renderComponent()) {
        clearInterval(pollInterval);
      } else if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        if (!getToolOutput()) {
          console.warn('[FrontMCP] Timeout waiting for toolOutput');
          showError('Timeout waiting for data');
        }
      }
    }, 100);
  }
  </script>`
      : '';

  // Page title
  const pageTitle = title || `${escapeHtml(toolName)} - Tool Widget`;

  // Build loading indicator and error display
  // Skip loader for inline mode - data is already embedded, SSR content is visible immediately
  const loaderHtml =
    isReactBased && componentCode && !hasEmbeddedData
      ? `
  <!-- Loading State -->
  <div id="frontmcp-loader" style="display: flex; align-items: center; justify-content: center; padding: 2rem; gap: 0.5rem;">
    <svg class="animate-spin" style="width: 1.25rem; height: 1.25rem; color: #6b7280;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    <span style="color: #6b7280; font-size: 0.875rem;">Loading widget...</span>
  </div>
  <div id="frontmcp-error" style="display: none; padding: 1rem; margin: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; color: #dc2626; font-size: 0.875rem;"></div>
  `
      : '';

  // Wrap SSR content in a root element for React to render into
  // For static mode: widget root is hidden until data arrives (loader shows first)
  // For inline mode: widget root is VISIBLE immediately (data is embedded, SSR is rendered)
  const widgetRootStyle = hasEmbeddedData ? '' : 'display: none;';

  const wrappedContent =
    isReactBased && componentCode
      ? `${loaderHtml}<div id="frontmcp-widget-root" style="${widgetRootStyle}">${ssrContent}</div>`
      : ssrContent;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${cspMetaTag}

  <!-- Fonts -->
  ${fontPreconnect}
  ${fontStylesheets}

  <!-- Tailwind CSS -->
  ${scripts}
  ${styleBlock}

  <!-- Spinner Animation -->
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
  </style>

  <!-- Tool Metadata -->
  ${toolNameScript}

  <!-- FrontMCP Bridge (Universal - Reads data from host at runtime) -->
  ${bridgeScript}
</head>
<body class="bg-background text-text-primary font-sans antialiased">
  ${wrappedContent}
  ${reactModuleScript}
</body>
</html>`;
}

// ============================================
// OpenAI-Specific Functions
// ============================================

/**
 * Build OpenAI Apps SDK specific meta annotations.
 * These are placed in _meta field of the tool response.
 */
export function buildOpenAIMeta(options: {
  csp?: WrapToolUIOptions['csp'];
  widgetAccessible?: boolean;
  widgetDescription?: string;
  displayMode?: 'inline' | 'fullscreen' | 'pip';
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  // Widget accessibility
  if (options.widgetAccessible) {
    meta['openai/widgetAccessible'] = true;
  }

  // Widget description
  if (options.widgetDescription) {
    meta['openai/widgetDescription'] = options.widgetDescription;
  }

  // CSP configuration
  if (options.csp) {
    const cspConfig: Record<string, string[]> = {};
    if (options.csp.connectDomains?.length) {
      cspConfig['connect_domains'] = options.csp.connectDomains;
    }
    if (options.csp.resourceDomains?.length) {
      cspConfig['resource_domains'] = options.csp.resourceDomains;
    }
    if (Object.keys(cspConfig).length > 0) {
      meta['openai/widgetCSP'] = cspConfig;
    }
  }

  // Display mode hint
  if (options.displayMode && options.displayMode !== 'inline') {
    meta['openai/displayMode'] = options.displayMode;
  }

  return meta;
}

/**
 * Get the MIME type for tool UI responses based on target platform
 */
export function getToolUIMimeType(platform: 'openai' | 'ext-apps' | 'generic' = 'generic'): string {
  switch (platform) {
    case 'openai':
      return 'text/html+skybridge';
    case 'ext-apps':
      return 'text/html+mcp';
    default:
      return 'text/html';
  }
}

// ============================================
// Claude-Specific Wrapper (Cloudflare CDN)
// ============================================

/**
 * Cloudflare CDN URLs for Claude Artifacts.
 *
 * Claude's sandbox only trusts cdnjs.cloudflare.com.
 * These are pre-built files (not JIT compilers).
 */
const CLOUDFLARE_CDN = {
  tailwindCss: 'https://cdnjs.cloudflare.com/ajax/libs/tailwindcss-browser/4.1.13/index.global.min.js',
  htmx: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.4/htmx.min.js',
  alpinejs: 'https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.14.3/cdn.min.js',
} as const;

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
export function wrapToolUIForClaude(options: WrapToolUIForClaudeOptions): string {
  const { content, toolName, input = {}, output, title, includeHtmx = false, includeAlpine = false } = options;

  // Build Tailwind CSS link (pre-built, not JIT)
  const tailwindCss = `<script src="${CLOUDFLARE_CDN.tailwindCss}" crossorigin="anonymous"></script>`;
  // Optional scripts (only from cloudflare)
  const htmxScript = includeHtmx ? `<script src="${CLOUDFLARE_CDN.htmx}" crossorigin="anonymous"></script>` : '';

  const alpineScript = includeAlpine
    ? `<script src="${CLOUDFLARE_CDN.alpinejs}" crossorigin="anonymous" defer></script>`
    : '';

  // Embed data for JavaScript access
  const helpers = createTemplateHelpers();
  const dataScript = `<script>
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpToolInput = ${helpers.jsonEmbed(input)};
  window.__mcpToolOutput = ${helpers.jsonEmbed(output)};
</script>`;

  // Page title
  const pageTitle = title || `${escapeHtml(toolName)} - Tool Result`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${tailwindCss}
  ${htmxScript}
  ${alpineScript}
  ${dataScript}
</head>
<body class="bg-gray-100 p-4">
  ${content}
</body>
</html>`;
}
