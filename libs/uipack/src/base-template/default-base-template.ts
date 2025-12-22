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
import { renderBridgeScript } from './bridge';

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
  /**
   * Additional head content (scripts, meta tags).
   * @warning This content is injected WITHOUT escaping. Only use with trusted content.
   */
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
    containerClass = 'p-4',
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

  // Build reactive bridge (handles data injection and re-rendering)
  const bridge = renderBridgeScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeAttr(toolName)} Widget</title>
  ${themeStyles}
  ${polyfills}
  ${bridge}
  ${headContent}
</head>
<body class="${escapeAttr(bodyClass)}">
  <div id="widget-root" class="${escapeAttr(containerClass)}"></div>

  <script>
  (function() {
    'use strict';

    var root = document.getElementById('widget-root');

    /**
     * Render the widget based on bridge state.
     * Uses the reactive bridge to automatically re-render when data changes.
     */
    function render() {
      var state = window.__frontmcp.bridge.getState();

      // Loading state
      if (state.loading) {
        root.innerHTML = renderLoading();
        return;
      }

      // Error state
      if (state.error) {
        root.innerHTML = renderError(state.error);
        return;
      }

      // No data state
      if (state.data === null) {
        root.innerHTML = renderEmpty();
        return;
      }

      // Render data
      try {
        // Check for custom renderer provided by developer
        if (window.__frontmcp && typeof window.__frontmcp.renderContent === 'function') {
          root.innerHTML = window.__frontmcp.renderContent(state.data);
          return;
        }

        // Fall back to default renderer
        root.innerHTML = defaultRenderer(state.data);
      } catch (e) {
        console.error('[frontmcp] Error rendering widget:', e);
        root.innerHTML = renderError(e.message || 'Render error');
      }
    }

    /**
     * Default renderer for tool output.
     * Handles both pre-rendered HTML strings and raw JSON data.
     */
    function defaultRenderer(data) {
      // Check if data is pre-rendered HTML (server-side rendered widget)
      if (typeof data === 'string' && data.trim().startsWith('<')) {
        // Direct HTML injection - content was already rendered/sanitized server-side
        return data;
      }

      // Check for special wrapper with HTML content
      if (data && typeof data === 'object' && data.__html) {
        return data.__html;
      }

      // Fallback: JSON renderer for raw data
      var json = JSON.stringify(data, null, 2);
      return '<pre class="p-4 bg-surface rounded-md overflow-auto text-sm font-mono text-text-primary border border-border">' +
        escapeHtml(json) +
        '</pre>';
    }

    /**
     * Render loading state with animated spinner.
     */
    function renderLoading() {
      return '<div class="flex items-center justify-center p-8">' +
        '<div class="flex flex-col items-center gap-3">' +
        '<svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">' +
        '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
        '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
        '</svg>' +
        '<p class="text-text-secondary text-sm">Loading...</p>' +
        '</div>' +
        '</div>';
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
     * Render empty state (no data available).
     */
    function renderEmpty() {
      return '<div class="p-4 text-text-secondary text-sm text-center">' +
        'No data available' +
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
     * Create debug overlay panel.
     * Shows bridge state, logs, and OpenAI data status.
     */
    function createDebugOverlay() {
      var overlay = document.createElement('div');
      overlay.id = 'frontmcp-debug-overlay';
      overlay.style.cssText = 'position:fixed;bottom:10px;right:10px;width:400px;max-height:60vh;' +
        'background:rgba(0,0,0,0.9);color:#0f0;font-family:monospace;font-size:11px;' +
        'padding:10px;border-radius:4px;z-index:99999;overflow:auto;display:none;';

      var toggle = document.createElement('button');
      toggle.id = 'frontmcp-debug-toggle';
      toggle.textContent = 'Debug';
      toggle.style.cssText = 'position:fixed;bottom:10px;right:10px;padding:4px 8px;' +
        'background:#333;color:#0f0;font-family:monospace;font-size:10px;border:1px solid #0f0;' +
        'border-radius:4px;z-index:100000;cursor:pointer;';

      toggle.onclick = function() {
        var o = document.getElementById('frontmcp-debug-overlay');
        if (o.style.display === 'none') {
          o.style.display = 'block';
          toggle.style.right = '420px';
          updateDebugOverlay();
        } else {
          o.style.display = 'none';
          toggle.style.right = '10px';
        }
      };

      document.body.appendChild(overlay);
      document.body.appendChild(toggle);

      // Auto-update every second
      setInterval(updateDebugOverlay, 1000);
    }

    function updateDebugOverlay() {
      var overlay = document.getElementById('frontmcp-debug-overlay');
      if (!overlay || overlay.style.display === 'none') return;

      var state = window.__frontmcp.bridge.getState();
      var debug = window.__frontmcp.bridge.debug;
      var logs = debug.getLogs();
      var errors = debug.getLastErrors();
      var stateHistory = debug.getStateHistory();

      var html = '<div style="margin-bottom:10px;border-bottom:1px solid #333;padding-bottom:5px;">' +
        '<strong>FrontMCP Debug Panel</strong>' +
        '<span style="float:right;color:#666;">v' + stateHistory.version + '</span>' +
        '</div>';

      // Bridge State
      html += '<div style="margin-bottom:10px;">' +
        '<div style="color:#ff0;">Bridge State:</div>' +
        '<div>Loading: ' + state.loading + '</div>' +
        '<div>Has Data: ' + (state.data !== null) + '</div>' +
        '<div>Data Type: ' + (state.data === null ? 'null' : typeof state.data) + '</div>' +
        (typeof state.data === 'string' ? '<div>Data Length: ' + state.data.length + '</div>' : '') +
        '<div>Error: ' + (state.error || 'none') + '</div>' +
        '</div>';

      // OpenAI Status
      html += '<div style="margin-bottom:10px;">' +
        '<div style="color:#ff0;">OpenAI Status:</div>' +
        '<div>Intercepted: ' + stateHistory.openaiIntercepted + '</div>' +
        '<div>Poll Count: ' + stateHistory.pollCount + '</div>';

      if (window.openai) {
        html += '<div>window.openai: exists</div>' +
          '<div>toolOutput: ' + (window.openai.toolOutput !== undefined ? 'present' : 'undefined') + '</div>' +
          '<div>toolResponseMetadata: ' + (window.openai.toolResponseMetadata !== undefined ? 'present' : 'undefined') + '</div>';
        if (window.openai.toolResponseMetadata) {
          html += '<div>meta keys: ' + Object.keys(window.openai.toolResponseMetadata).join(', ') + '</div>';
        }
      } else {
        html += '<div>window.openai: undefined</div>';
      }
      html += '</div>';

      // Errors
      if (errors.length > 0) {
        html += '<div style="margin-bottom:10px;">' +
          '<div style="color:#f00;">Errors (' + errors.length + '):</div>';
        errors.slice(-5).forEach(function(e) {
          html += '<div style="color:#f88;font-size:10px;">[' + e.level + '] ' + escapeHtml(e.message) + '</div>';
        });
        html += '</div>';
      }

      // Recent Logs
      html += '<div>' +
        '<div style="color:#ff0;">Recent Logs (' + logs.length + '):</div>' +
        '<div style="max-height:150px;overflow:auto;">';
      logs.slice(-10).forEach(function(e) {
        var color = e.level === 'error' ? '#f00' : e.level === 'warn' ? '#ff0' : '#0f0';
        html += '<div style="color:' + color + ';font-size:10px;">' +
          '[' + e.ts.split('T')[1].split('.')[0] + '] ' + escapeHtml(e.message) +
          '</div>';
      });
      html += '</div></div>';

      // Actions
      html += '<div style="margin-top:10px;border-top:1px solid #333;padding-top:5px;">' +
        '<button onclick="console.log(window.__frontmcp.bridge.debug.dumpAll())" ' +
        'style="font-size:10px;padding:2px 6px;margin-right:5px;">Dump to Console</button>' +
        '<button onclick="window.__frontmcp.bridge.reset()" ' +
        'style="font-size:10px;padding:2px 6px;">Reset Bridge</button>' +
        '</div>';

      overlay.innerHTML = html;
    }

    /**
     * Initialize the widget with reactive rendering.
     */
    function init() {
      // Subscribe to bridge state changes for reactive re-rendering
      window.__frontmcp.bridge.subscribe(render);

      // Initial render
      render();

      // Global click handler for SSR-compatible tool calls
      // Handles buttons/elements with data-tool-call attribute
      document.addEventListener('click', function(e) {
        var target = e.target;
        // Walk up the DOM to find element with data-tool-call (handles clicks on child elements)
        while (target && target !== document.body) {
          if (target.hasAttribute && target.hasAttribute('data-tool-call')) {
            var toolName = target.getAttribute('data-tool-call');
            var argsStr = target.getAttribute('data-tool-args');
            var args = {};

            if (argsStr) {
              try {
                args = JSON.parse(argsStr);
              } catch (parseErr) {
                console.error('[frontmcp] Failed to parse data-tool-args:', parseErr);
              }
            }

            // Prevent default behavior and stop propagation
            e.preventDefault();
            e.stopPropagation();

            // Show loading state on the button
            var originalContent = target.innerHTML;
            var loadingContent = '<span style="display:inline-flex;align-items:center;">' +
              '<span style="animation:spin 1s linear infinite;margin-right:4px;">⏳</span>' +
              'Loading...' +
              '</span>';
            target.innerHTML = loadingContent;
            target.disabled = true;

            // Call the tool
            if (window.__frontmcp && typeof window.__frontmcp.callTool === 'function') {
              window.__frontmcp.callTool(toolName, args)
                .then(function(result) {
                  console.log('[frontmcp] Tool call success:', toolName, result);
                  // Restore button state on success
                  target.innerHTML = originalContent;
                  target.disabled = false;
                })
                .catch(function(err) {
                  console.error('[frontmcp] Tool call failed:', toolName, err);
                  // Restore button state on error
                  target.innerHTML = originalContent;
                  target.disabled = false;
                });
            } else {
              console.error('[frontmcp] callTool not available');
              target.innerHTML = originalContent;
              target.disabled = false;
            }

            return;
          }
          target = target.parentElement;
        }
      });

      // Create debug overlay if debug mode is enabled
      var DEBUG = window.location.search.indexOf('frontmcp_debug=1') > -1 ||
                  window.localStorage.getItem('frontmcp_debug') === '1';
      if (DEBUG) {
        createDebugOverlay();
      }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
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
