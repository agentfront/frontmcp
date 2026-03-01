/**
 * UI Resource Handler
 *
 * Handles resources/read requests for ui:// URIs, serving widget HTML
 * from the ToolUIRegistry.
 *
 * Supported URI format:
 * - ui://widget/{toolName}.html - Static widget HTML (pre-compiled at startup)
 *
 * The static widget is registered at server startup for tools with
 * `servingMode: 'static'`. The widget HTML includes the FrontMCP Bridge
 * which reads tool output from the platform context at runtime.
 *
 * @example
 * ```typescript
 * // Client requests widget HTML (OpenAI discovery)
 * const result = await client.readResource({
 *   uri: 'ui://widget/get_weather.html'
 * });
 *
 * // Returns pre-compiled widget with FrontMCP Bridge
 * // Widget reads tool output from window.openai.toolOutput at runtime
 * ```
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { AIPlatformType } from '../../notification/notification.service';
// TODO: Re-implement against new @frontmcp/uipack API after redesign
// import { createDefaultBaseTemplate } from '@frontmcp/uipack/base-template';
// import { ... } from '@frontmcp/uipack/registry';
import { type ToolUIRegistry, isUIResourceUri, parseWidgetUri, getUIResourceMimeType } from './ui-shared';

function createDefaultBaseTemplate(_options: { toolName: string }): string {
  return `<!DOCTYPE html><html><body><div id="root">Placeholder widget for ${_options.toolName}</div></body></html>`;
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
 * Delegates to @frontmcp/uipack's createDefaultBaseTemplate which provides:
 * - Tailwind CSS with @theme configuration
 * - Platform polyfills (callTool, detectMcpSession, getToolOutput)
 * - Polling for toolOutput injection
 * - Default JSON renderer (data-type-specific renderers are in @frontmcp/uipack)
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

  // Try static widget URI (ui://widget/{toolName}.html)
  // This is used by OpenAI at discovery time
  const widgetParsed = parseWidgetUri(uri);
  if (widgetParsed) {
    // Check for pre-compiled static widget from the developer's template
    // Static widgets are compiled at server startup for tools with servingMode: 'static'
    const cachedWidget = registry.getStaticWidget(widgetParsed.toolName);
    if (cachedWidget) {
      // Return the developer's actual template (SSR'd React/MDX component)
      // This template includes the FrontMCP Bridge for runtime data access
      return {
        handled: true,
        result: {
          contents: [
            {
              uri,
              mimeType,
              text: cachedWidget,
            },
          ],
        },
      };
    }

    // Fallback to dynamic placeholder widget if no pre-compiled template.
    // This is returned when the tool doesn't have a UI template configured
    // or uses a different serving mode.
    //
    // OpenAI caches widget HTML from outputTemplate URI, so we must return
    // a template that reads from window.openai.toolOutput at runtime.
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

  // Unknown UI resource URI format
  return {
    handled: true,
    error: `Invalid UI resource URI format: ${uri}. Expected: ui://widget/{toolName}.html`,
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
