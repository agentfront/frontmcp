/**
 * UI Resource Handler
 *
 * Handles resources/read requests for ui:// URIs, serving cached widget HTML
 * from the ToolUIRegistry.
 *
 * URI format: ui://tools/{toolName}/result/{requestId}
 *
 * @example
 * ```typescript
 * // Client requests widget HTML
 * const result = await client.readResource({
 *   uri: 'ui://tools/get_weather/result/abc123'
 * });
 *
 * // Returns:
 * // {
 * //   contents: [{
 * //     uri: 'ui://tools/get_weather/result/abc123',
 * //     mimeType: 'text/html',
 * //     text: '<div>Weather widget HTML...</div>'
 * //   }]
 * // }
 * ```
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolUIRegistry } from './tool-ui.registry';
import type { AIPlatformType } from '../../notification/notification.service';

/**
 * UI resource URI scheme
 */
export const UI_RESOURCE_SCHEME = 'ui://';

/**
 * Pattern for UI resource URIs: ui://tools/{toolName}/result/{requestId}
 */
const UI_URI_PATTERN = /^ui:\/\/tools\/([^/]+)\/result\/([^/]+)$/;

/**
 * Pattern for static widget URIs: ui://widget/{toolName}.html
 * This format is used by OpenAI at discovery time (tools/list)
 */
const UI_WIDGET_PATTERN = /^ui:\/\/widget\/([^/]+)\.html$/;

/**
 * Parse a UI resource URI
 *
 * @param uri - URI to parse
 * @returns Parsed components or undefined if not a valid UI URI
 */
export interface ParsedUIUri {
  toolName: string;
  requestId: string;
  fullUri: string;
}

/**
 * Parsed static widget URI
 */
export interface ParsedWidgetUri {
  toolName: string;
  fullUri: string;
}

/**
 * Check if a URI is a UI resource URI
 *
 * @param uri - URI to check
 * @returns True if the URI starts with ui://
 */
export function isUIResourceUri(uri: string): boolean {
  return uri.startsWith(UI_RESOURCE_SCHEME);
}

/**
 * Parse a UI resource URI into its components
 *
 * @param uri - URI to parse
 * @returns Parsed components or undefined if invalid
 */
export function parseUIResourceUri(uri: string): ParsedUIUri | undefined {
  const match = uri.match(UI_URI_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    toolName: decodeURIComponent(match[1]),
    requestId: decodeURIComponent(match[2]),
    fullUri: uri,
  };
}

/**
 * Parse a static widget URI into its components
 *
 * @param uri - URI to parse (format: ui://widget/{toolName}.html)
 * @returns Parsed components or undefined if invalid
 */
export function parseWidgetUri(uri: string): ParsedWidgetUri | undefined {
  const match = uri.match(UI_WIDGET_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    toolName: decodeURIComponent(match[1]),
    fullUri: uri,
  };
}

/**
 * Check if URI is a static widget URI (ui://widget/{toolName}.html)
 */
export function isStaticWidgetUri(uri: string): boolean {
  return UI_WIDGET_PATTERN.test(uri);
}

/**
 * Build a static widget URI from tool name
 *
 * @param toolName - Name of the tool
 * @returns Static widget URI (ui://widget/{toolName}.html)
 */
export function buildStaticWidgetUri(toolName: string): string {
  return `ui://widget/${encodeURIComponent(toolName)}.html`;
}

/**
 * Build a UI resource URI from components
 *
 * @param toolName - Name of the tool
 * @param requestId - Request ID
 * @returns Formatted UI resource URI
 */
export function buildUIResourceUri(toolName: string, requestId: string): string {
  return `ui://tools/${encodeURIComponent(toolName)}/result/${encodeURIComponent(requestId)}`;
}

/**
 * Result of handling a UI resource request
 */
export interface UIResourceHandleResult {
  /** Whether the URI was handled */
  handled: boolean;
  /** The resource result if handled successfully */
  result?: ReadResourceResult;
  /** Error message if handling failed */
  error?: string;
}

/**
 * Options for handling a UI resource read request
 */
export interface HandleUIResourceOptions {
  /** The UI resource URI */
  uri: string;
  /** The ToolUIRegistry containing cached HTML */
  registry: ToolUIRegistry;
  /** Platform type of the connected client */
  platformType?: AIPlatformType;
}

/**
 * Generate a placeholder widget HTML that reads from window.openai.toolOutput.
 * This is returned when the static widget URI is fetched before the tool is called.
 *
 * OpenAI injects structuredContent into window.openai.toolOutput AFTER the widget loads,
 * so we poll every 500ms until data is available.
 *
 * The widget uses the same styling as @frontmcp/ui components to match the demo app.
 *
 * @param toolName - The name of the tool
 * @returns HTML string with a dynamic widget that renders toolOutput
 */
function generatePlaceholderWidget(toolName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${toolName} Widget</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#24292f',
            secondary: '#57606a',
            accent: '#0969da',
            success: '#1a7f37',
            warning: '#9a6700',
            danger: '#cf222e',
            info: '#0969da',
            border: '#d0d7de',
            divider: '#d8dee4',
            'text-primary': '#24292f',
            'text-secondary': '#57606a',
          }
        }
      }
    }
  </script>
  <style>
    .loading::after {
      content: '';
      display: inline-block;
      width: 20px;
      height: 20px;
      margin-left: 10px;
      border: 2px solid #d0d7de;
      border-top-color: #24292f;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body class="bg-transparent font-sans">
  <div id="widget" class="p-4 max-w-sm mx-auto">
    <div id="content" class="loading text-center text-text-secondary py-10">Loading</div>
  </div>
  <script>
    (function() {
      var container = document.getElementById('content');
      var rendered = false;
      var intervalId = null;

      var weatherIcons = {
        'sunny': '☀️', 'clear': '☀️', 'sun': '☀️',
        'cloudy': '☁️', 'clouds': '☁️', 'overcast': '☁️', 'partly cloudy': '⛅',
        'rain': '🌧️', 'rainy': '🌧️', 'drizzle': '🌦️', 'showers': '🌧️',
        'storm': '⛈️', 'thunderstorm': '⛈️', 'thunder': '⛈️',
        'snow': '❄️', 'snowy': '❄️', 'blizzard': '🌨️',
        'fog': '🌫️', 'foggy': '🌫️', 'mist': '🌫️', 'haze': '🌫️',
        'wind': '💨', 'windy': '💨',
        'default': '🌤️'
      };

      function getWeatherIcon(conditions, icon) {
        if (icon && weatherIcons[icon]) return weatherIcons[icon];
        if (!conditions) return weatherIcons.default;
        var c = conditions.toLowerCase();
        for (var key in weatherIcons) {
          if (c.indexOf(key) !== -1) return weatherIcons[key];
        }
        return weatherIcons.default;
      }

      function getBadgeVariant(conditions) {
        if (!conditions) return 'secondary';
        var c = conditions.toLowerCase();
        if (c.indexOf('sun') !== -1 || c.indexOf('clear') !== -1) return 'success';
        if (c.indexOf('rain') !== -1) return 'info';
        return 'secondary';
      }

      function isWeatherData(data) {
        if (!data || typeof data !== 'object') return false;
        return ('temperature' in data || 'temp' in data) &&
               ('location' in data || 'city' in data || 'conditions' in data || 'weather' in data);
      }

      function escapeHtml(str) {
        if (typeof str !== 'string') return String(str || '');
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function renderWeatherCard(data) {
        var temp = data.temperature ?? data.temp ?? '--';
        var unit = (data.units || data.unit || 'celsius').toLowerCase();
        var tempSymbol = unit.indexOf('f') === 0 ? '°F' : '°C';
        var location = data.location || data.city || 'Unknown';
        var conditions = data.conditions || data.weather || data.description || '';
        var humidity = data.humidity;
        var windSpeed = data.windSpeed ?? data.wind_speed ?? data.wind;
        var icon = getWeatherIcon(conditions, data.icon);
        var badgeVariant = getBadgeVariant(conditions);

        // Badge colors matching @frontmcp/ui
        var badgeColors = {
          success: 'bg-success/10 text-success',
          info: 'bg-info/10 text-info',
          secondary: 'bg-secondary/10 text-secondary'
        };
        var badgeClass = badgeColors[badgeVariant] || badgeColors.secondary;

        // Build description list items
        var details = [];
        if (humidity !== undefined) {
          details.push({ term: 'Humidity', description: humidity + '%' });
        }
        if (windSpeed !== undefined) {
          details.push({ term: 'Wind Speed', description: windSpeed + ' km/h' });
        }
        details.push({ term: 'Units', description: unit.charAt(0).toUpperCase() + unit.slice(1) });

        var detailsHtml = details.map(function(item) {
          return '<div class="relative p-4 bg-gray-50 rounded-lg">' +
            '<dt class="text-sm font-medium text-text-secondary">' + escapeHtml(item.term) + '</dt>' +
            '<dd class="mt-1 text-sm text-text-primary font-medium">' + escapeHtml(item.description) + '</dd>' +
          '</div>';
        }).join('\\n');

        // Card matching @frontmcp/ui card component with elevated variant
        return '<div class="bg-white rounded-xl shadow-lg p-6 max-w-sm mx-auto">' +
          '<div class="flex items-start justify-between mb-4">' +
            '<div>' +
              '<h3 class="text-lg font-semibold text-text-primary">' + escapeHtml(location) + '</h3>' +
              '<p class="text-sm text-text-secondary mt-1">Current Weather</p>' +
            '</div>' +
          '</div>' +
          '<div class="text-center py-6">' +
            '<div class="text-6xl mb-2">' + icon + '</div>' +
            '<div class="text-5xl font-light text-text-primary mb-2">' + Math.round(temp) + tempSymbol + '</div>' +
            '<div class="flex justify-center">' +
              '<span class="inline-flex items-center font-medium rounded-md ' + badgeClass + ' px-2.5 py-1 text-xs">' +
                escapeHtml(conditions) +
              '</span>' +
            '</div>' +
          '</div>' +
          '<dl class="grid grid-cols-2 gap-4 mt-4">' + detailsHtml + '</dl>' +
        '</div>';
      }

      function formatJson(obj, indent) {
        indent = indent || 0;
        var spaces = '  '.repeat(indent);
        if (obj === null) return '<span class="text-gray-400">null</span>';
        if (typeof obj === 'boolean') return '<span class="text-red-600">' + obj + '</span>';
        if (typeof obj === 'number') return '<span class="text-blue-600">' + obj + '</span>';
        if (typeof obj === 'string') return '<span class="text-green-700">"' + escapeHtml(obj) + '"</span>';
        if (Array.isArray(obj)) {
          if (obj.length === 0) return '[]';
          var items = obj.map(function(v) { return spaces + '  ' + formatJson(v, indent + 1); });
          return '[\\n' + items.join(',\\n') + '\\n' + spaces + ']';
        }
        if (typeof obj === 'object') {
          var keys = Object.keys(obj);
          if (keys.length === 0) return '{}';
          var pairs = keys.map(function(k) {
            return spaces + '  <span class="text-blue-800">"' + k + '"</span>: ' + formatJson(obj[k], indent + 1);
          });
          return '{\\n' + pairs.join(',\\n') + '\\n' + spaces + '}';
        }
        return String(obj);
      }

      function renderOutput(data) {
        if (rendered) return;
        rendered = true;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        try {
          container.className = '';
          if (isWeatherData(data)) {
            container.innerHTML = renderWeatherCard(data);
          } else {
            container.innerHTML = '<div class="bg-white rounded-xl shadow-lg p-6 border border-border">' +
              '<pre class="whitespace-pre-wrap break-words text-xs leading-relaxed font-mono">' +
              formatJson(data, 0) + '</pre></div>';
          }
        } catch (e) {
          container.className = 'text-danger bg-danger/10 p-4 rounded-lg';
          container.textContent = 'Error rendering: ' + e.message;
        }
      }

      function checkForData() {
        if (window.openai && window.openai.toolOutput !== undefined && window.openai.toolOutput !== null) {
          renderOutput(window.openai.toolOutput);
          return true;
        }
        return false;
      }

      if (!checkForData()) {
        intervalId = setInterval(function() {
          checkForData();
        }, 500);
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Get the MIME type for UI resources based on platform.
 *
 * Per user requirement: OpenAI or default uses 'text/html+skybridge'
 *
 * @param platformType - The detected platform type
 * @returns The appropriate MIME type
 */
export function getUIResourceMimeType(platformType?: AIPlatformType): string {
  // Per requirement: "for openai or default text/html+skybridge"
  // This aligns with OpenAI's skybridge widget protocol
  switch (platformType) {
    case 'claude':
      // Claude uses standard text/html (network-blocked environment)
      return 'text/html';
    case 'gemini':
      // Gemini uses standard text/html
      return 'text/html';
    case 'openai':
    case 'cursor':
    case 'continue':
    case 'cody':
    case 'generic-mcp':
    case 'unknown':
    default:
      // OpenAI and default use skybridge MIME type
      return 'text/html+skybridge';
  }
}

/**
 * Handle a UI resource read request
 *
 * @param uri - The UI resource URI
 * @param registry - The ToolUIRegistry containing cached HTML
 * @param platformType - Optional platform type for dynamic MIME type selection
 * @returns Handle result with content or error
 */
export function handleUIResourceRead(
  uri: string,
  registry: ToolUIRegistry,
  platformType?: AIPlatformType,
): UIResourceHandleResult {
  // Check if this is a UI resource URI
  if (!isUIResourceUri(uri)) {
    return { handled: false };
  }

  // Get the platform-appropriate MIME type
  const mimeType = getUIResourceMimeType(platformType);

  // Try static widget URI first (ui://widget/{toolName}.html)
  // This is used by OpenAI at discovery time
  const widgetParsed = parseWidgetUri(uri);
  if (widgetParsed) {
    // ALWAYS return the dynamic placeholder widget for static URIs.
    // OpenAI caches widget HTML from outputTemplate URI, so we must return
    // a template that reads from window.openai.toolOutput at runtime.
    // This ensures fresh structuredContent is rendered on each tool call.
    const html = generatePlaceholderWidget(widgetParsed.toolName);

    return {
      handled: true,
      result: {
        contents: [
          {
            uri,
            mimeType,
            text: html,
          },
        ],
      },
    };
  }

  // Try dynamic URI (ui://tools/{toolName}/result/{requestId})
  const parsed = parseUIResourceUri(uri);
  if (!parsed) {
    return {
      handled: true,
      error: `Invalid UI resource URI format: ${uri}. Expected: ui://tools/{toolName}/result/{requestId} or ui://widget/{toolName}.html`,
    };
  }

  // Try to get cached HTML from the registry by exact URI
  const cachedEntry = registry.getCachedEntry(uri);
  if (!cachedEntry) {
    // Also try to get just by the HTML (in case cached with different URI format)
    const html = registry.getRenderedHtml(uri);
    if (!html) {
      return {
        handled: true,
        error: `UI resource not found or expired: ${uri}`,
      };
    }

    // Return the HTML as a resource
    return {
      handled: true,
      result: {
        contents: [
          {
            uri,
            mimeType,
            text: html,
          },
        ],
      },
    };
  }

  // Return the cached HTML
  return {
    handled: true,
    result: {
      contents: [
        {
          uri,
          mimeType,
          text: cachedEntry.html,
        },
      ],
    },
  };
}

/**
 * Options for creating a UI resource handler
 */
export interface UIResourceHandlerOptions {
  /** ToolUIRegistry instance */
  registry: ToolUIRegistry;
  /** Optional custom error handler */
  onError?: (error: string, uri: string) => void;
}

/**
 * Create a UI resource handler function
 *
 * @param options - Handler options
 * @returns Handler function that can be used in the read-resource flow
 */
export function createUIResourceHandler(options: UIResourceHandlerOptions) {
  const { registry, onError } = options;

  return function handleUIResource(uri: string): UIResourceHandleResult {
    const result = handleUIResourceRead(uri, registry);

    if (result.handled && result.error && onError) {
      onError(result.error, uri);
    }

    return result;
  };
}
