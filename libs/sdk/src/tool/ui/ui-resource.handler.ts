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

import type { ReadResourceResult } from '@frontmcp/protocol';
import { createDefaultBaseTemplate } from '@frontmcp/uipack/adapters';

import type { AIPlatformType } from '../../notification/notification.service';
import {
  getUIResourceMimeType,
  isUIResourceUri,
  parseWidgetUri,
  type ToolUIRegistry,
  type UIResourceMeta,
} from './ui-shared';

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
 * Build the `_meta` payload to attach to the widget resource's `contents[]`
 * item. Returns `undefined` when no CSP / permissions were configured so the
 * caller can omit `_meta` entirely.
 *
 * Issue #455: MCP Apps hosts (Claude in particular) only honor CSP declared
 * on the UI resource (i.e. the `resources/read` content item's `_meta`), not
 * on the tool's `_meta.ui.csp`. Emitting CSP here is what makes
 * `ui.csp.connectDomains` / `ui.csp.resourceDomains` actually take effect.
 */
function buildResourceMetaForWidget(registry: ToolUIRegistry, toolName: string): Record<string, unknown> | undefined {
  const meta = registry.getResourceMeta(toolName);
  if (!meta) return undefined;
  const ui: Record<string, unknown> = {};
  if (meta.csp) {
    ui['csp'] = normalizeCspForResource(meta.csp);
  }
  if (meta.permissions !== undefined) {
    ui['permissions'] = meta.permissions;
  }
  if (Object.keys(ui).length === 0) return undefined;
  // Emit BOTH the nested form (`_meta.ui.csp` — what MCP Apps spec docs use)
  // and the slash form (`_meta['ui/csp']` — what the broader FrontMCP `_meta`
  // convention uses) so hosts on either side resolve it. They're cheap.
  const out: Record<string, unknown> = { ui };
  if (ui['csp'] !== undefined) out['ui/csp'] = ui['csp'];
  if (ui['permissions'] !== undefined) out['ui/permissions'] = ui['permissions'];
  return out;
}

/**
 * Convert the user-facing camelCase CSP shape (`connectDomains` /
 * `resourceDomains`) into the snake_case form MCP Apps hosts read
 * (`connect_domains` / `resource_domains`). Preserves any extra keys
 * the caller passed through so unknown / future-spec CSP fields are
 * not silently dropped.
 */
function normalizeCspForResource(csp: NonNullable<UIResourceMeta['csp']>): Record<string, unknown> {
  const { connectDomains, resourceDomains, ...rest } = csp as NonNullable<UIResourceMeta['csp']> &
    Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (connectDomains !== undefined) out['connect_domains'] = connectDomains;
  if (resourceDomains !== undefined) out['resource_domains'] = resourceDomains;
  return out;
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
    // Per-resource `_meta` (CSP / permissions). Claude only honors CSP
    // declared on the resource content item, not on the tool's
    // `_meta.ui.csp` — see issue #455.
    const resourceMeta = buildResourceMetaForWidget(registry, widgetParsed.toolName);

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
              ...(resourceMeta ? { _meta: resourceMeta } : {}),
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
            ...(resourceMeta ? { _meta: resourceMeta } : {}),
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
