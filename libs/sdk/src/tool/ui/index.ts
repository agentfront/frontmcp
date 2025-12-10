/**
 * Tool UI Module
 *
 * Provides UI template rendering and platform-specific metadata generation
 * for MCP tool responses.
 *
 * Two serving modes:
 * - **inline**: HTML is rendered per-request and embedded in _meta['ui/html']
 * - **mcp-resource**: Static widget is pre-compiled at startup, client fetches via resources/read
 */

// Registry
export { ToolUIRegistry } from './tool-ui.registry';
export type { RenderOptions, UIRenderResult } from './tool-ui.registry';

// Template rendering
export { renderToolTemplateAsync, hasUIConfig, isReactComponent } from './render-template';
export type { RenderTemplateOptions } from './render-template';

// Platform adapters
export { buildUIMeta } from './platform-adapters';
export type { UIMetadata, BuildUIMetaOptions } from './platform-adapters';

// Template helpers
export {
  escapeHtml,
  formatDate,
  formatCurrency,
  uniqueId,
  jsonEmbed,
  createTemplateHelpers,
  resetIdCounter,
} from './template-helpers';

// UI Resource Handler
export {
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseWidgetUri,
  buildStaticWidgetUri,
  handleUIResourceRead,
  createUIResourceHandler,
  getUIResourceMimeType,
} from './ui-resource.handler';
export type {
  ParsedWidgetUri,
  UIResourceHandleResult,
  UIResourceHandlerOptions,
  HandleUIResourceOptions,
} from './ui-resource.handler';

// UI Resource Templates (for capability advertisement)
export { StaticWidgetResourceTemplate } from './ui-resource-template';
