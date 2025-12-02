/**
 * Tool UI Module
 *
 * Provides UI template rendering and platform-specific metadata generation
 * for MCP tool responses.
 */

// Registry
export { ToolUIRegistry } from './tool-ui.registry';
export type { RenderAndRegisterOptions, UIRegistrationResult, CachedUI } from './tool-ui.registry';

// Template rendering
export { renderToolTemplate, hasUIConfig } from './render-template';
export type { RenderTemplateOptions } from './render-template';

// Platform adapters
export { buildUIMeta, platformSupportsUI, platformSupportsResourceURI } from './platform-adapters';
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

// Widget tokens
export { WidgetTokenManager, generateWidgetSecret, createDefaultTokenManager } from './widget-token';
export type { WidgetTokenPayload, GenerateWidgetTokenOptions, ValidateWidgetTokenResult } from './widget-token';

// UI Resource Handler
export {
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseUIResourceUri,
  parseWidgetUri,
  buildUIResourceUri,
  buildStaticWidgetUri,
  handleUIResourceRead,
  createUIResourceHandler,
  getUIResourceMimeType,
} from './ui-resource.handler';
export type {
  ParsedUIUri,
  ParsedWidgetUri,
  UIResourceHandleResult,
  UIResourceHandlerOptions,
  HandleUIResourceOptions,
} from './ui-resource.handler';

// UI Resource Templates (for capability advertisement)
export { ToolUIResourceTemplate, StaticWidgetResourceTemplate } from './ui-resource-template';
