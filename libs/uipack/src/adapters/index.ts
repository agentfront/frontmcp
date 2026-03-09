/**
 * @frontmcp/uipack/adapters
 *
 * SDK integration layer for the UI pipeline.
 * Provides rendering, serving mode resolution, and response formatting
 * aligned with the MCP Apps protocol specification.
 *
 * @packageDocumentation
 */

// ============================================
// Constants
// ============================================
export { MCP_APPS_MIME_TYPE, MCP_APPS_EXTENSION_ID } from './constants';

// ============================================
// Serving Mode
// ============================================
export {
  resolveServingMode,
  type ResolveServingModeOptions,
  type ServingModeResult,
  type AdapterPlatformType,
} from './serving-mode';

// ============================================
// Response Builder
// ============================================
export {
  buildToolResponseContent,
  type ToolResponseContent,
  type BuildToolResponseContentOptions,
} from './response-builder';

// ============================================
// Render Failure
// ============================================
export { isUIRenderFailure, type UIRenderFailure } from './render-failure';

// ============================================
// Template Renderer
// ============================================
export { renderToolTemplate, type RenderToolTemplateOptions, type RenderToolTemplateResult } from './template-renderer';

// ============================================
// Content Detection & Rendering
// ============================================
export { detectContentType, type DetectedContentType } from './content-detector';
export { buildChartHtml, buildMermaidHtml, buildPdfHtml, wrapDetectedContent } from './content-renderers';

// ============================================
// Base Template
// ============================================
export { createDefaultBaseTemplate, type DefaultBaseTemplateOptions } from './base-template';

// ============================================
// CDN Info
// ============================================
export { buildCDNInfoForUIType, type CDNInfo, type CDNDependencyInfo } from './cdn-info';

// ============================================
// Type Detection
// ============================================
export { detectUIType } from './type-detector';
