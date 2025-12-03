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
import { createDefaultBaseTemplate } from '@frontmcp/ui';

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
 *
 * Delegates to @frontmcp/ui's createDefaultBaseTemplate which provides:
 * - Tailwind CSS with @theme configuration
 * - Platform polyfills (callTool, detectMcpSession, getToolOutput)
 * - Polling for toolOutput injection
 * - Default JSON renderer (data-type-specific renderers are in @frontmcp/ui)
 *
 * This is returned when the static widget URI is fetched before the tool is called.
 * OpenAI caches this HTML, so it must be dynamic (read toolOutput at runtime).
 *
 * @param toolName - The name of the tool
 * @returns HTML string with a dynamic widget that renders toolOutput
 */
function generatePlaceholderWidget(toolName: string): string {
  return createDefaultBaseTemplate({ toolName });
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
