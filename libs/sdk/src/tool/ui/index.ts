/**
 * Tool UI Module
 *
 * Provides UI template rendering and platform-specific metadata generation
 * for MCP tool responses.
 *
 * Three serving modes:
 * - **inline**: HTML is rendered per-request and embedded in _meta['ui/html']
 * - **static**: Static widget is pre-compiled at startup, client fetches via resources/read
 * - **hybrid**: Shell (React + renderer) cached at startup, component + data in response
 *
 * NOTE: Core Tool UI functionality is in @frontmcp/uipack/registry for standalone usage.
 * This module re-exports from @frontmcp/uipack for backwards compatibility.
 */

// ============================================
// Core Registry (from @frontmcp/uipack/registry)
// ============================================
export {
  // Registry
  ToolUIRegistry,
  // Template rendering
  renderToolTemplateAsync,
  renderToolTemplate,
  hasUIConfig,
  isReactComponent,
  containsMdxSyntax,
  // URI utilities
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseWidgetUri,
  buildStaticWidgetUri,
  getUIResourceMimeType,
} from '@frontmcp/uipack/registry';

export type {
  // Registry types
  RenderOptions,
  UIRenderResult,
  CompileStaticWidgetOptions,
  HybridComponentPayload,
  BuildHybridComponentPayloadOptions,
  // Template types
  RenderTemplateOptions,
  // URI types
  ParsedWidgetUri,
} from '@frontmcp/uipack/registry';

// ============================================
// Platform Adapters (from @frontmcp/ui/adapters)
// ============================================
export { buildUIMeta } from './platform-adapters';
export type { UIMetadata, BuildUIMetaOptions } from './platform-adapters';

// ============================================
// Template Helpers (from @frontmcp/ui/runtime)
// ============================================
export {
  escapeHtml,
  formatDate,
  formatCurrency,
  uniqueId,
  jsonEmbed,
  createTemplateHelpers,
  resetIdCounter,
} from './template-helpers';

// ============================================
// SDK-Specific (MCP Integration)
// ============================================
// UI Resource Handler - SDK-specific functions for MCP resource handling
export { handleUIResourceRead, createUIResourceHandler } from './ui-resource.handler';
export type { UIResourceHandleResult, UIResourceHandlerOptions, HandleUIResourceOptions } from './ui-resource.handler';

// UI Resource Templates (for capability advertisement)
export { StaticWidgetResourceTemplate } from './ui-resource-template';
