/**
 * Tool UI Wrapper
 *
 * Wraps tool UI templates with the MCP Bridge runtime and
 * integrates with the existing layout system for consistent styling.
 */

import type { WrapToolUIOptions, HostContext } from './types';
import { MCP_BRIDGE_RUNTIME } from './mcp-bridge';
import { buildCSPMetaTag, buildCSPDirectives } from './csp';
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
import { escapeHtml } from '../layouts/base';
import { sanitizeInput as sanitizeInputFn, type SanitizerFn } from './sanitizer';
import { BRIDGE_SCRIPT_TAGS } from '../bridge/runtime/iife-generator';

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
  } = options;

  // Merge theme
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Build font links (skip for inline mode / blocked network)
  const fontPreconnect = inlineScripts ? '' : buildFontPreconnect();
  const fontStylesheets = inlineScripts ? '' : buildFontStylesheets({ inter: true });

  // Build CDN scripts
  const scripts = buildCdnScripts({
    tailwind: true,
    htmx: false,
    alpine: false,
    icons: false,
    inline: inlineScripts,
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
  const frameworkScripts = buildFrameworkRuntimeScriptsUniversal({
    rendererType,
    hydrate,
    inlineScripts,
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
 */
function buildFrameworkRuntimeScriptsUniversal(options: {
  rendererType?: string;
  hydrate?: boolean;
  inlineScripts?: boolean;
}): string {
  const { rendererType, hydrate, inlineScripts } = options;

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
    if (!inlineScripts) {
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
      // For inline mode, skip hydration
      return `
  <!-- React hydration disabled (inline scripts mode) -->
  <script>
    console.warn('[FrontMCP] React hydration disabled - inline scripts mode');
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
}

/**
 * Wrap a static widget template for MCP resource mode.
 *
 * Unlike `wrapToolUIUniversal`, this function creates a widget that:
 * - Does NOT embed data (input/output/structuredContent)
 * - Reads data at runtime from the FrontMCP Bridge (window.openai.toolOutput)
 * - Is cached at server startup and returned for all requests
 *
 * This is used for `servingMode: 'mcp-resource'` where OpenAI caches the
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
  const { toolName, ssrContent, uiConfig, title, theme: themeOverrides } = options;

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

  // Universal bridge script (works on all platforms)
  // This will read data from window.openai.toolOutput at runtime
  const bridgeScript = BRIDGE_SCRIPT_TAGS.universal;

  // Tool name injection (for Bridge to know which tool this is)
  // NOTE: Unlike wrapToolUIUniversal, we do NOT inject input/output/structuredContent
  // The Bridge will read data from window.openai.toolOutput at runtime
  const helpers = createTemplateHelpers();
  const toolNameScript = `<script>
  // Tool metadata (static widget - data injected by host at runtime)
  window.__mcpToolName = ${helpers.jsonEmbed(toolName)};
  window.__mcpWidgetAccessible = ${helpers.jsonEmbed(uiConfig.widgetAccessible ?? false)};
  // Data will be provided by host platform:
  // - OpenAI: window.openai.toolOutput
  // - FrontMCP Bridge: window.__mcpToolOutput, window.__mcpStructuredContent
</script>`;

  // Page title
  const pageTitle = title || `${escapeHtml(toolName)} - Tool Widget`;

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

  <!-- Tool Metadata -->
  ${toolNameScript}

  <!-- FrontMCP Bridge (Universal - Reads data from host at runtime) -->
  ${bridgeScript}
</head>
<body class="bg-background text-text-primary font-sans antialiased">
  ${ssrContent}
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
