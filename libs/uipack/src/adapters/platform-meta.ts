/**
 * Platform Metadata Adapters
 *
 * Build platform-specific _meta fields for tool UI responses.
 * Adapts the UI configuration to the format expected by each
 * AI platform (OpenAI, Claude, Gemini, etc.).
 *
 * This module is SDK-independent and can be used by external systems
 * like AgentLink without requiring @frontmcp/sdk.
 *
 * @packageDocumentation
 */

import type { UITemplateConfig, UIContentSecurityPolicy } from '../types';

// ============================================
// Platform Types
// ============================================

/**
 * Supported AI platform types.
 * Used to determine which metadata format to generate.
 */
export type AIPlatformType =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'cursor'
  | 'continue'
  | 'cody'
  | 'generic-mcp'
  | 'ext-apps'
  | 'unknown';

// ============================================
// UI Metadata
// ============================================

/**
 * UI metadata to include in tool response _meta field.
 * Contains both universal fields and platform-specific annotations.
 */
export interface UIMetadata {
  // Universal fields
  /** Inline rendered HTML (universal) */
  'ui/html'?: string;
  /** MIME type for the HTML content */
  'ui/mimeType'?: string;
  /** Widget token for authenticated operations */
  'ui/widgetToken'?: string;
  /** Direct URL to widget (for direct-url serving mode) */
  'ui/directUrl'?: string;

  // Widget manifest fields (new)
  /** Renderer type for the widget (html, react, mdx, markdown, auto) */
  'ui/type'?: string;
  /** Manifest URI for accessing widget configuration */
  'ui/manifestUri'?: string;
  /** Hash of the widget content for cache validation */
  'ui/contentHash'?: string;
  /** Required renderer assets for lazy loading */
  'ui/requiredRenderers'?: string[];

  // OpenAI-specific fields
  /** OpenAI: Resource URI for widget template */
  'openai/outputTemplate'?: string;
  /** OpenAI: Whether widget can invoke tools */
  'openai/widgetAccessible'?: boolean;
  /** OpenAI: Whether tool result can produce a widget (CRITICAL for ChatGPT) */
  'openai/resultCanProduceWidget'?: boolean;
  /** OpenAI: CSP configuration */
  'openai/widgetCSP'?: {
    connect_domains?: string[];
    resource_domains?: string[];
  };
  /** OpenAI: Display mode preference */
  'openai/displayMode'?: string;
  /** OpenAI: Widget description */
  'openai/widgetDescription'?: string;
  /** OpenAI: Status text while tool is executing */
  'openai/toolInvocation/invoking'?: string;
  /** OpenAI: Status text after tool execution completes */
  'openai/toolInvocation/invoked'?: string;

  // Claude-specific fields
  /** Claude: Widget description */
  'claude/widgetDescription'?: string;
  /** Claude: Display mode preference */
  'claude/displayMode'?: string;
  /** Claude: Whether widget can invoke tools (informational) */
  'claude/widgetAccessible'?: boolean;
  /** Claude: Whether to show border around UI */
  'claude/prefersBorder'?: boolean;

  // FrontMCP-specific fields (generic platform)
  /** FrontMCP: Whether widget can invoke tools */
  'frontmcp/widgetAccessible'?: boolean;
  /** FrontMCP: CSP configuration */
  'frontmcp/widgetCSP'?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };
  /** FrontMCP: Display mode preference */
  'frontmcp/displayMode'?: string;
  /** FrontMCP: Widget description */
  'frontmcp/widgetDescription'?: string;
  /** FrontMCP: Whether to show border around UI */
  'frontmcp/prefersBorder'?: boolean;
  /** FrontMCP: Dedicated sandbox domain */
  'frontmcp/domain'?: string;

  // Gemini-specific fields
  /** Gemini: Widget description */
  'gemini/widgetDescription'?: string;

  // IDE-specific fields (Cursor, Continue, Cody)
  /** IDE: Resource URI for widget template */
  'ide/outputTemplate'?: string;
  /** IDE: Widget description */
  'ide/widgetDescription'?: string;

  // MCP Apps (ext-apps) fields - per specification
  /** MCP Apps: Resource URI for UI template */
  'ui/resourceUri'?: string;
  /** MCP Apps: CSP configuration */
  'ui/csp'?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };
  /** MCP Apps: Dedicated sandbox domain */
  'ui/domain'?: string;
  /** MCP Apps: Whether to show border around UI */
  'ui/prefersBorder'?: boolean;
  /** MCP Apps: Display mode */
  'ui/displayMode'?: 'inline' | 'fullscreen' | 'pip';

  /** Allow additional platform-specific fields */
  [key: string]: unknown;
}

// ============================================
// Build Options
// ============================================

/**
 * Options for building UI metadata.
 */
export interface BuildUIMetaOptions<In = unknown, Out = unknown> {
  /** Tool UI configuration */
  uiConfig: UITemplateConfig<In, Out>;
  /** Detected platform type */
  platformType: AIPlatformType;
  /** Rendered HTML content */
  html: string;
  /** Widget access token */
  token?: string;
  /** Direct URL for widget serving */
  directUrl?: string;
  /** Renderer type for the widget (html, react, mdx, markdown, auto) */
  rendererType?: string;
  /** Hash of the widget content for cache validation */
  contentHash?: string;
  /** Manifest URI for accessing widget configuration */
  manifestUri?: string;
}

// ============================================
// Main Builder Function
// ============================================

/**
 * Build platform-specific UI metadata for tool response.
 *
 * For inline serving mode (default), HTML is embedded directly in `_meta['ui/html']`.
 * For static mode, the static widget URI is provided in tools/list
 * and the tool response contains only structured data.
 *
 * @example
 * ```typescript
 * import { buildUIMeta } from '@frontmcp/ui/adapters';
 *
 * const meta = buildUIMeta({
 *   uiConfig: { template: (ctx) => `<div>${ctx.output.value}</div>` },
 *   platformType: 'openai',
 *   html: '<div>Hello World</div>',
 * });
 * ```
 */
export function buildUIMeta<In = unknown, Out = unknown>(options: BuildUIMetaOptions<In, Out>): UIMetadata {
  const { uiConfig, platformType, html, token, directUrl, rendererType, contentHash, manifestUri } = options;

  const meta: UIMetadata = {};

  // Platform-specific meta keys - each platform gets its own namespace
  switch (platformType) {
    case 'openai':
      // OpenAI uses openai/* namespace only
      meta['openai/html'] = html;
      meta['openai/mimeType'] = 'text/html+skybridge';
      if (rendererType) meta['openai/type'] = rendererType;
      if (contentHash) meta['openai/contentHash'] = contentHash;
      if (manifestUri) meta['openai/manifestUri'] = manifestUri;
      if (token) meta['openai/widgetToken'] = token;
      if (directUrl) meta['openai/directUrl'] = directUrl;
      return buildOpenAIMeta(meta, uiConfig);

    case 'ext-apps':
      // ext-apps (SEP-1865) uses ui/* namespace only
      meta['ui/html'] = html;
      meta['ui/mimeType'] = 'text/html+mcp';
      if (rendererType) meta['ui/type'] = rendererType;
      if (contentHash) meta['ui/contentHash'] = contentHash;
      if (manifestUri) meta['ui/manifestUri'] = manifestUri;
      if (token) meta['ui/widgetToken'] = token;
      if (directUrl) meta['ui/directUrl'] = directUrl;
      return buildExtAppsMeta(meta, uiConfig);

    case 'claude':
    case 'cursor':
    case 'continue':
    case 'cody':
    case 'generic-mcp':
    case 'gemini':
    default:
      // All other platforms use ui/* namespace only (no frontmcp/* duplication)
      meta['ui/html'] = html;
      meta['ui/mimeType'] = 'text/html+mcp';
      if (rendererType) meta['ui/type'] = rendererType;
      if (contentHash) meta['ui/contentHash'] = contentHash;
      if (manifestUri) meta['ui/manifestUri'] = manifestUri;
      if (token) meta['ui/widgetToken'] = token;
      if (directUrl) meta['ui/directUrl'] = directUrl;

      // Platform-specific additions
      if (platformType === 'claude') {
        return buildClaudeMeta(meta, uiConfig);
      } else if (platformType === 'gemini') {
        return buildGeminiMeta(meta, uiConfig);
      } else if (platformType === 'cursor' || platformType === 'continue' || platformType === 'cody') {
        return buildIDEMeta(meta, uiConfig);
      } else if (platformType === 'generic-mcp') {
        return buildGenericMeta(meta, uiConfig);
      }
      return meta;
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build OpenAI-specific metadata for tool CALL response (inline mode).
 *
 * NOTE: Per OpenAI's pizzaz example, the call response should only include
 * invocation status in _meta. The outputTemplate, resultCanProduceWidget, etc.
 * are discovery-time fields that belong in tools/list _meta, NOT in call response.
 *
 * For static mode: OpenAI fetches the widget HTML from the outputTemplate URI
 * (set in tools/list) and injects structuredContent as window.openai.toolOutput.
 * For inline mode: HTML is embedded directly in _meta['ui/html'].
 */
function buildOpenAIMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  // Only include invocation status in call response _meta
  // (per pizzaz example - they don't include outputTemplate in call response)
  if (uiConfig.invocationStatus?.invoking) {
    meta['openai/toolInvocation/invoking'] = uiConfig.invocationStatus.invoking;
  }
  if (uiConfig.invocationStatus?.invoked) {
    meta['openai/toolInvocation/invoked'] = uiConfig.invocationStatus.invoked;
  }

  return meta;
}

/**
 * Build OpenAI CSP format.
 */
export function buildOpenAICSP(csp: UIContentSecurityPolicy): {
  connect_domains?: string[];
  resource_domains?: string[];
} {
  const result: { connect_domains?: string[]; resource_domains?: string[] } = {};

  if (csp.connectDomains?.length) {
    result.connect_domains = csp.connectDomains;
  }

  if (csp.resourceDomains?.length) {
    result.resource_domains = csp.resourceDomains;
  }

  return result;
}

/**
 * Build Claude-specific metadata.
 * Claude widgets are network-blocked, so we don't include URI references.
 * Uses claude/* namespace for Claude-specific fields.
 */
function buildClaudeMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  // Claude uses inline HTML only (network-blocked)
  // Don't include resource URI since Claude can't fetch it

  // Widget description
  if (uiConfig.widgetDescription) {
    meta['claude/widgetDescription'] = uiConfig.widgetDescription;
  }

  // Display mode preference (Claude may respect this for Artifacts)
  if (uiConfig.displayMode) {
    meta['claude/displayMode'] = uiConfig.displayMode;
  }

  // Widget accessibility hint (informational for Claude)
  // Note: Claude's Artifact system may not support tool callbacks,
  // but we include this for consistency and future compatibility
  if (uiConfig.widgetAccessible) {
    meta['claude/widgetAccessible'] = true;
  }

  // Border preference (useful for Artifacts visual styling)
  if (uiConfig.prefersBorder !== undefined) {
    meta['claude/prefersBorder'] = uiConfig.prefersBorder;
  }

  // Note: We don't include CSP for Claude since it's network-blocked
  // and CSP policies aren't applicable in the sandboxed iframe

  return meta;
}

/**
 * Build Gemini-specific metadata.
 */
function buildGeminiMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  // Gemini support is limited - include inline HTML
  // Future: Add Gemini-specific fields when they're defined

  if (uiConfig.widgetDescription) {
    meta['gemini/widgetDescription'] = uiConfig.widgetDescription;
  }

  return meta;
}

/**
 * Build IDE-specific metadata (Cursor, Continue, Cody).
 * For inline mode, HTML is embedded directly in _meta['ui/html'].
 */
function buildIDEMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  if (uiConfig.widgetDescription) {
    meta['ide/widgetDescription'] = uiConfig.widgetDescription;
  }

  return meta;
}

/**
 * Build FrontMCP CSP format (camelCase like MCP Apps spec).
 * Used for generic-mcp platform metadata.
 */
export function buildFrontMCPCSP(csp: UIContentSecurityPolicy): {
  connectDomains?: string[];
  resourceDomains?: string[];
} {
  const result: { connectDomains?: string[]; resourceDomains?: string[] } = {};

  if (csp.connectDomains?.length) {
    result.connectDomains = csp.connectDomains;
  }

  if (csp.resourceDomains?.length) {
    result.resourceDomains = csp.resourceDomains;
  }

  return result;
}

/**
 * Build generic MCP client metadata.
 * Uses ui/* namespace for all fields.
 * For inline mode, HTML is embedded directly in _meta['ui/html'].
 */
function buildGenericMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  // Content Security Policy (uses camelCase per MCP Apps spec)
  if (uiConfig.csp) {
    const csp: { connectDomains?: string[]; resourceDomains?: string[] } = {};

    if (uiConfig.csp.connectDomains?.length) {
      csp.connectDomains = uiConfig.csp.connectDomains;
    }

    if (uiConfig.csp.resourceDomains?.length) {
      csp.resourceDomains = uiConfig.csp.resourceDomains;
    }

    if (Object.keys(csp).length > 0) {
      meta['ui/csp'] = csp;
    }
  }

  // Display mode preference
  if (uiConfig.displayMode) {
    // Map generic display modes to MCP Apps specific values
    const displayModeMap: Record<string, 'inline' | 'fullscreen' | 'pip'> = {
      inline: 'inline',
      fullscreen: 'fullscreen',
      pip: 'pip',
      widget: 'inline',
      panel: 'fullscreen',
    };
    const mappedMode = displayModeMap[uiConfig.displayMode];
    if (mappedMode) {
      meta['ui/displayMode'] = mappedMode;
    }
  }

  // Border preference
  if (uiConfig.prefersBorder !== undefined) {
    meta['ui/prefersBorder'] = uiConfig.prefersBorder;
  }

  // Sandbox domain
  if (uiConfig.sandboxDomain) {
    meta['ui/domain'] = uiConfig.sandboxDomain;
  }

  return meta;
}

/**
 * Build MCP Apps (ext-apps) metadata per specification.
 * For inline mode, HTML is embedded directly in _meta['ui/html'].
 *
 * Per MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps
 * - ui/csp: Content security policy for sandboxed iframe
 * - ui/displayMode: How the UI should be displayed
 * - ui/prefersBorder: Whether to show border around UI
 * - ui/domain: Optional dedicated sandbox domain
 */
function buildExtAppsMeta<In, Out>(meta: UIMetadata, uiConfig: UITemplateConfig<In, Out>): UIMetadata {
  // MCP Apps uses text/html+mcp MIME type
  meta['ui/mimeType'] = 'text/html+mcp';

  // CSP configuration (uses camelCase per MCP Apps spec)
  if (uiConfig.csp) {
    const csp: { connectDomains?: string[]; resourceDomains?: string[] } = {};

    if (uiConfig.csp.connectDomains?.length) {
      csp.connectDomains = uiConfig.csp.connectDomains;
    }

    if (uiConfig.csp.resourceDomains?.length) {
      csp.resourceDomains = uiConfig.csp.resourceDomains;
    }

    if (Object.keys(csp).length > 0) {
      meta['ui/csp'] = csp;
    }
  }

  // Display mode preference
  if (uiConfig.displayMode) {
    // Map generic display modes to MCP Apps specific values
    const displayModeMap: Record<string, 'inline' | 'fullscreen' | 'pip'> = {
      inline: 'inline',
      fullscreen: 'fullscreen',
      pip: 'pip',
      // Map OpenAI-style values
      widget: 'inline',
      panel: 'fullscreen',
    };
    const mappedMode = displayModeMap[uiConfig.displayMode];
    if (mappedMode) {
      meta['ui/displayMode'] = mappedMode;
    }
  }

  // Border preference (default: true for visual clarity in sandbox)
  if (uiConfig.prefersBorder !== undefined) {
    meta['ui/prefersBorder'] = uiConfig.prefersBorder;
  }

  // Dedicated sandbox domain (optional)
  if (uiConfig.sandboxDomain) {
    meta['ui/domain'] = uiConfig.sandboxDomain;
  }

  return meta;
}

// ============================================
// Tool Discovery Metadata
// ============================================

/**
 * Build metadata for tool discovery (tools/list response).
 * This includes fields that should be present at discovery time,
 * not in individual tool call responses.
 *
 * @example
 * ```typescript
 * import { buildToolDiscoveryMeta } from '@frontmcp/ui/adapters';
 *
 * const toolMeta = buildToolDiscoveryMeta({
 *   uiConfig: { template: MyWidget, widgetAccessible: true },
 *   platformType: 'openai',
 *   staticWidgetUri: 'ui://widget/my_tool.html',
 * });
 *
 * // Use in tools/list response
 * const tool = {
 *   name: 'my_tool',
 *   description: '...',
 *   inputSchema: {...},
 *   _meta: toolMeta,
 * };
 * ```
 */
export interface BuildToolDiscoveryMetaOptions<In = unknown, Out = unknown> {
  /** Tool UI configuration */
  uiConfig: UITemplateConfig<In, Out>;
  /** Detected platform type */
  platformType: AIPlatformType;
  /** Static widget URI (e.g., ui://widget/my_tool.html) */
  staticWidgetUri: string;
}

/**
 * Build tool discovery metadata (for tools/list response).
 */
export function buildToolDiscoveryMeta<In = unknown, Out = unknown>(
  options: BuildToolDiscoveryMetaOptions<In, Out>,
): UIMetadata {
  const { uiConfig, platformType, staticWidgetUri } = options;

  const meta: UIMetadata = {};

  switch (platformType) {
    case 'openai':
      // OpenAI-specific discovery fields
      meta['openai/outputTemplate'] = staticWidgetUri;
      meta['openai/resultCanProduceWidget'] = true;

      if (uiConfig.widgetAccessible) {
        meta['openai/widgetAccessible'] = true;
      }

      if (uiConfig.csp) {
        meta['openai/widgetCSP'] = buildOpenAICSP(uiConfig.csp);
      }

      if (uiConfig.displayMode) {
        meta['openai/displayMode'] = uiConfig.displayMode;
      }

      if (uiConfig.widgetDescription) {
        meta['openai/widgetDescription'] = uiConfig.widgetDescription;
      }
      break;

    case 'generic-mcp':
      // Generic MCP uses OpenAI-like format
      meta['openai/outputTemplate'] = staticWidgetUri;
      meta['openai/resultCanProduceWidget'] = true;

      if (uiConfig.widgetAccessible) {
        meta['openai/widgetAccessible'] = true;
      }

      if (uiConfig.csp) {
        meta['openai/widgetCSP'] = buildOpenAICSP(uiConfig.csp);
      }
      break;

    case 'ext-apps':
      // MCP Apps discovery metadata per specification
      meta['ui/resourceUri'] = staticWidgetUri;
      meta['ui/mimeType'] = 'text/html+mcp';

      if (uiConfig.csp) {
        const csp: { connectDomains?: string[]; resourceDomains?: string[] } = {};
        if (uiConfig.csp.connectDomains?.length) {
          csp.connectDomains = uiConfig.csp.connectDomains;
        }
        if (uiConfig.csp.resourceDomains?.length) {
          csp.resourceDomains = uiConfig.csp.resourceDomains;
        }
        if (Object.keys(csp).length > 0) {
          meta['ui/csp'] = csp;
        }
      }

      if (uiConfig.displayMode) {
        const displayModeMap: Record<string, 'inline' | 'fullscreen' | 'pip'> = {
          inline: 'inline',
          fullscreen: 'fullscreen',
          pip: 'pip',
        };
        const mappedMode = displayModeMap[uiConfig.displayMode];
        if (mappedMode) {
          meta['ui/displayMode'] = mappedMode;
        }
      }

      if (uiConfig.prefersBorder !== undefined) {
        meta['ui/prefersBorder'] = uiConfig.prefersBorder;
      }

      if (uiConfig.sandboxDomain) {
        meta['ui/domain'] = uiConfig.sandboxDomain;
      }
      break;

    // Claude, Gemini, IDEs don't need discovery metadata
    // They use inline HTML at call time
    default:
      break;
  }

  return meta;
}
