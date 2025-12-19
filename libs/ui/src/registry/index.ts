/**
 * @frontmcp/ui Registry Module
 *
 * Standalone widget building without @frontmcp/sdk.
 *
 * This module enables external platforms (like AgentLink) to use FrontMCP's
 * widget compilation and rendering system without requiring the full SDK.
 *
 * @example
 * ```typescript
 * import {
 *   ToolUIRegistry,
 *   renderToolTemplateAsync,
 *   buildStaticWidgetUri,
 * } from '@frontmcp/ui/registry';
 *
 * // Create a registry for widget management
 * const registry = new ToolUIRegistry();
 *
 * // Compile static widgets at startup
 * await registry.compileStaticWidgetAsync({
 *   toolName: 'get_weather',
 *   template: WeatherWidget,
 *   uiConfig: { template: WeatherWidget, ... },
 * });
 *
 * // Render inline widgets at tool call time
 * const result = await registry.renderAndRegisterAsync({
 *   toolName: 'get_weather',
 *   requestId: 'abc123',
 *   input: { location: 'London' },
 *   output: { temp: 72 },
 *   uiConfig,
 *   platformType: 'openai',
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Core Registry
// ============================================

export { ToolUIRegistry, isUIRenderFailure } from './tool-ui.registry';
export type {
  RenderOptions,
  UIRenderResult,
  UIRenderFailure,
  CompileStaticWidgetOptions,
  HybridComponentPayload,
  BuildHybridComponentPayloadOptions,
} from './tool-ui.registry';

// ============================================
// Template Rendering
// ============================================

export {
  renderToolTemplate,
  renderToolTemplateAsync,
  isReactComponent,
  hasUIConfig,
  containsMdxSyntax,
} from './render-template';
export type { RenderTemplateOptions } from './render-template';

// ============================================
// URI Utilities
// ============================================

export {
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseWidgetUri,
  buildStaticWidgetUri,
  getUIResourceMimeType,
} from './uri-utils';
export type { ParsedWidgetUri } from './uri-utils';
