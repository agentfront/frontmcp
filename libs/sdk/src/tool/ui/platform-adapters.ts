/**
 * Platform Adapters
 *
 * Build platform-specific _meta fields for tool UI responses.
 * Adapts the UI configuration to the format expected by each
 * AI platform (OpenAI, Claude, Gemini, etc.).
 */

import type { ToolUIConfig, UIContentSecurityPolicy } from '../../common/metadata/tool-ui.metadata';
import type { AIPlatformType } from '../../notification/notification.service';

/**
 * UI metadata to include in tool response _meta field.
 */
export interface UIMetadata {
  /** Inline rendered HTML (universal) */
  'ui/html'?: string;
  /** MIME type for the HTML content */
  'ui/mimeType'?: string;
  /** Widget token for authenticated operations */
  'ui/widgetToken'?: string;
  /** Direct URL to widget (for direct-url serving mode) */
  'ui/directUrl'?: string;

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

  /** Allow additional platform-specific fields */
  [key: string]: unknown;
}

/**
 * Options for building UI metadata.
 */
export interface BuildUIMetaOptions {
  /** Tool UI configuration */
  uiConfig: ToolUIConfig;
  /** Detected platform type */
  platformType: AIPlatformType;
  /** Generated resource URI (e.g., ui://tools/get_weather/result/abc123) */
  resourceUri: string;
  /** Rendered HTML content */
  html: string;
  /** Widget access token */
  token?: string;
  /** Direct URL for widget serving */
  directUrl?: string;
}

/**
 * Build platform-specific UI metadata for tool response.
 */
export function buildUIMeta(options: BuildUIMetaOptions): UIMetadata {
  const { uiConfig, platformType, resourceUri, html, token, directUrl } = options;

  const meta: UIMetadata = {};

  // Universal fields - always include inline HTML
  meta['ui/html'] = html;
  meta['ui/mimeType'] = getMimeType(platformType);

  // Include token if provided
  if (token) {
    meta['ui/widgetToken'] = token;
  }

  // Include direct URL if provided
  if (directUrl) {
    meta['ui/directUrl'] = directUrl;
  }

  // Platform-specific fields
  switch (platformType) {
    case 'openai':
      return buildOpenAIMeta(meta, uiConfig, resourceUri);

    case 'claude':
      return buildClaudeMeta(meta, uiConfig);

    case 'gemini':
      return buildGeminiMeta(meta, uiConfig);

    case 'cursor':
    case 'continue':
    case 'cody':
      return buildIDEMeta(meta, uiConfig, resourceUri);

    case 'generic-mcp':
      return buildGenericMeta(meta, uiConfig, resourceUri);

    default:
      // Unknown platform - just return universal fields
      return meta;
  }
}

/**
 * Get MIME type based on platform.
 */
function getMimeType(platformType: AIPlatformType): string {
  switch (platformType) {
    case 'openai':
      return 'text/html+skybridge';
    default:
      return 'text/html+mcp';
  }
}

/**
 * Build OpenAI-specific metadata for tool CALL response.
 *
 * NOTE: Per OpenAI's pizzaz example, the call response should only include
 * invocation status in _meta. The outputTemplate, resultCanProduceWidget, etc.
 * are discovery-time fields that belong in tools/list _meta, NOT in call response.
 *
 * OpenAI fetches the widget HTML from the outputTemplate URI (set in tools/list)
 * and injects structuredContent as window.openai.toolOutput for the widget to read.
 */
function buildOpenAIMeta(meta: UIMetadata, uiConfig: ToolUIConfig, _resourceUri: string): UIMetadata {
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
function buildOpenAICSP(csp: UIContentSecurityPolicy): {
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
 */
function buildClaudeMeta(meta: UIMetadata, uiConfig: ToolUIConfig): UIMetadata {
  // Claude uses inline HTML only (network-blocked)
  // Don't include resource URI since Claude can't fetch it

  if (uiConfig.widgetDescription) {
    meta['claude/widgetDescription'] = uiConfig.widgetDescription;
  }

  return meta;
}

/**
 * Build Gemini-specific metadata.
 */
function buildGeminiMeta(meta: UIMetadata, uiConfig: ToolUIConfig): UIMetadata {
  // Gemini support is limited - include inline HTML
  // Future: Add Gemini-specific fields when they're defined

  if (uiConfig.widgetDescription) {
    meta['gemini/widgetDescription'] = uiConfig.widgetDescription;
  }

  return meta;
}

/**
 * Build IDE-specific metadata (Cursor, Continue, Cody).
 */
function buildIDEMeta(meta: UIMetadata, uiConfig: ToolUIConfig, resourceUri: string): UIMetadata {
  // IDEs may support resource URIs
  meta['ide/outputTemplate'] = resourceUri;

  if (uiConfig.widgetDescription) {
    meta['ide/widgetDescription'] = uiConfig.widgetDescription;
  }

  return meta;
}

/**
 * Build generic MCP client metadata.
 */
function buildGenericMeta(meta: UIMetadata, uiConfig: ToolUIConfig, resourceUri: string): UIMetadata {
  // Generic MCP clients may support the OpenAI format
  meta['openai/outputTemplate'] = resourceUri;

  if (uiConfig.widgetAccessible) {
    meta['openai/widgetAccessible'] = true;
  }

  if (uiConfig.csp) {
    meta['openai/widgetCSP'] = buildOpenAICSP(uiConfig.csp);
  }

  return meta;
}

/**
 * Check if a platform supports UI widgets.
 */
export function platformSupportsUI(platformType: AIPlatformType): boolean {
  switch (platformType) {
    case 'openai':
    case 'claude':
    case 'gemini':
    case 'cursor':
    case 'continue':
    case 'cody':
    case 'generic-mcp':
      return true;
    default:
      return false;
  }
}

/**
 * Check if a platform supports resource URI references.
 */
export function platformSupportsResourceURI(platformType: AIPlatformType): boolean {
  switch (platformType) {
    case 'openai':
    case 'cursor':
    case 'continue':
    case 'cody':
    case 'generic-mcp':
      return true;
    case 'claude':
    case 'gemini':
      // These platforms are network-blocked or don't support resource fetching
      return false;
    default:
      return false;
  }
}
