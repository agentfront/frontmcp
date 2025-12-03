/**
 * Default Base Template for Tool UI
 *
 * Provides a generic HTML wrapper for tool output widgets that:
 * 1. Includes theming (Tailwind CSS with @theme)
 * 2. Includes platform polyfills (callTool, detectMcpSession)
 * 3. Polls for toolOutput from window.openai or window.__frontmcp
 * 4. Renders content via window.__frontmcp.renderContent or default JSON renderer
 *
 * This template is platform-agnostic and works with:
 * - OpenAI Apps SDK (window.openai.toolOutput)
 * - Claude Artifacts
 * - Custom hosts using MCP protocol
 * - ngrok/iframe scenarios
 */

import { DEFAULT_THEME, type ThemeConfig } from '../theme';
import { renderThemeStyles, type ThemeStylesOptions } from './theme-styles';
import { renderMcpSessionPolyfill, type McpSession } from './polyfills';

/**
 * Options for creating a default base template.
 */
export interface BaseTemplateOptions {
  /** Tool name for identification */
  toolName: string;
  /** Theme configuration */
  theme?: ThemeConfig;
  /** MCP session info for callTool polyfill fallback */
  mcpSession?: McpSession;
  /** Include HTMX (default: false) */
  htmx?: boolean;
  /** Include Alpine.js (default: false) */
  alpine?: boolean;
  /** Include fonts (default: true) */
  fonts?: boolean;
  /** Use inline scripts (for blocked network platforms) */
  inline?: boolean;
  /** Additional head content (scripts, meta tags) */
  headContent?: string;
  /** Custom body classes */
  bodyClass?: string;
  /** Custom widget container classes */
  containerClass?: string;
}

/**
 * Escape string for use in HTML attributes.
 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Create a default base template for tool UI widgets.
 *
 * This generates a complete HTML document that:
 * 1. Loads Tailwind CSS with theme configuration
 * 2. Injects platform polyfills (callTool, detectMcpSession, getToolOutput)
 * 3. Waits for toolOutput to be injected
 * 4. Renders content using window.__frontmcp.renderContent or default JSON renderer
 *
 * @param options - Base template configuration
 * @returns Complete HTML document string
 *
 * @example Basic usage
 * ```typescript
 * const html = createDefaultBaseTemplate({ toolName: 'get_weather' });
 * ```
 *
 * @example With custom theme and MCP session
 * ```typescript
 * const html = createDefaultBaseTemplate({
 *   toolName: 'get_weather',
 *   theme: customTheme,
 *   mcpSession: { mcpUrl: 'https://mcp.example.com', sessionId: 'abc123' },
 * });
 * ```
 *
 * @example For Claude Artifacts (inline scripts)
 * ```typescript
 * await fetchAndCacheScriptsFromTheme(theme);
 * const html = createDefaultBaseTemplate({
 *   toolName: 'get_weather',
 *   inline: true,
 * });
 * ```
 */
export function createDefaultBaseTemplate(options: BaseTemplateOptions): string {
  const {
    toolName,
    theme = DEFAULT_THEME,
    mcpSession,
    htmx = false,
    alpine = false,
    fonts = true,
    inline = false,
    headContent = '',
    bodyClass = 'bg-transparent font-sans antialiased',
    containerClass = 'min-h-screen p-4',
  } = options;

  // Build theme styles (fonts, scripts, @theme CSS)
  const themeStylesOptions: ThemeStylesOptions = {
    theme,
    tailwind: true,
    htmx,
    alpine,
    fonts,
    inline,
  };
  const themeStyles = renderThemeStyles(themeStylesOptions);

  // Build MCP session polyfill (detectMcpSession, callTool, getToolOutput)
  const polyfills = renderMcpSessionPolyfill(mcpSession);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeAttr(toolName)} Widget</title>
  ${themeStyles}
  ${polyfills}
  ${headContent}
</head>
<body class="${escapeAttr(bodyClass)}">
  <div id="widget-root" class="${escapeAttr(containerClass)}"></div>

  <script>
  (function() {
    'use strict';

    var root = document.getElementById('widget-root');
    var rendered = false;

    /**
     * Render the widget content using custom or default renderer.
     */
    function render(data) {
      if (rendered) return;
      rendered = true;

      try {
        // Check for custom renderer provided by developer
        if (window.__frontmcp && typeof window.__frontmcp.renderContent === 'function') {
          root.innerHTML = window.__frontmcp.renderContent(data);
          return;
        }

        // Fall back to default JSON renderer
        root.innerHTML = defaultRenderer(data);
      } catch (e) {
        console.error('[frontmcp] Error rendering widget:', e);
        root.innerHTML = renderError(e.message || 'Render error');
      }
    }

    /**
     * Default JSON renderer for tool output.
     */
    function defaultRenderer(data) {
      // Format JSON with syntax highlighting
      var json = JSON.stringify(data, null, 2);
      return '<pre class="p-4 bg-surface rounded-md overflow-auto text-sm font-mono text-text-primary border border-border">' +
        escapeHtml(json) +
        '</pre>';
    }

    /**
     * Render error message.
     */
    function renderError(message) {
      return '<div class="p-4 bg-red-50 border border-red-200 rounded-md">' +
        '<p class="text-red-600 text-sm">Error: ' + escapeHtml(message) + '</p>' +
        '</div>';
    }

    /**
     * Escape HTML special characters.
     */
    function escapeHtml(str) {
      if (typeof str !== 'string') return str;
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /**
     * Check for tool output from all possible sources.
     */
    function checkForData() {
      var data = window.__frontmcp.getToolOutput();
      if (data !== undefined) {
        render(data);
        return true;
      }
      return false;
    }

    /**
     * Poll for data injection with exponential backoff.
     */
    function pollForData() {
      if (checkForData()) return;

      var attempts = 0;
      var maxAttempts = 50; // ~10 seconds with exponential backoff
      var baseDelay = 50;

      function poll() {
        if (checkForData()) return;

        attempts++;
        if (attempts >= maxAttempts) {
          root.innerHTML = '<div class="p-4 text-text-secondary text-sm">' +
            'Waiting for data...' +
            '</div>';
          return;
        }

        // Exponential backoff: 50ms, 75ms, 112ms, 168ms, ...
        var delay = Math.min(baseDelay * Math.pow(1.5, Math.min(attempts, 10)), 1000);
        setTimeout(poll, delay);
      }

      poll();
    }

    // Start polling when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', pollForData);
    } else {
      pollForData();
    }
  })();
  </script>
</body>
</html>`;
}

/**
 * Create a minimal base template without fonts.
 *
 * Use this for lightweight widgets or when fonts are loaded elsewhere.
 *
 * @param toolName - Tool name for identification
 * @param mcpSession - Optional MCP session info
 * @returns Complete HTML document string
 */
export function createMinimalBaseTemplate(toolName: string, mcpSession?: McpSession): string {
  return createDefaultBaseTemplate({
    toolName,
    mcpSession,
    fonts: false,
    htmx: false,
    alpine: false,
  });
}
