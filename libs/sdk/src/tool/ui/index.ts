/**
 * Tool UI Module
 *
 * Provides UI template rendering and platform-specific metadata generation
 * for MCP tool responses.
 *
 * NOTE: Core registry functionality was removed from @frontmcp/uipack during redesign.
 * Stub implementations are provided until re-implementation against the new API.
 *
 * TODO: Re-implement against new @frontmcp/uipack shell/resolver/component API
 */

// ============================================
// Shared types & URI utilities (from ui-shared.ts)
// ============================================
export {
  ToolUIRegistry,
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseWidgetUri,
  buildStaticWidgetUri,
  getUIResourceMimeType,
} from './ui-shared';
export type { ParsedWidgetUri } from './ui-shared';

// ============================================
// Stub exports for registry functions
// (previously from @frontmcp/uipack/registry)
// ============================================

export function renderToolTemplateAsync(..._args: unknown[]): Promise<string> {
  return Promise.resolve('');
}

export function renderToolTemplate(..._args: unknown[]): string {
  return '';
}

/** Check if a tool entry has UI configuration */
export function hasUIConfig(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool === null) return false;
  const metadata = (tool as Record<string, unknown>)['ui'];
  return metadata !== undefined && metadata !== null;
}

export function isReactComponent(_template: unknown): boolean {
  return false;
}

export function containsMdxSyntax(_content: string): boolean {
  return false;
}

// Stub types (previously from @frontmcp/uipack/registry)
export interface RenderOptions {
  [key: string]: unknown;
}

export interface UIRenderResult {
  html: string;
  [key: string]: unknown;
}

export interface CompileStaticWidgetOptions {
  [key: string]: unknown;
}

export interface HybridComponentPayload {
  [key: string]: unknown;
}

export interface BuildHybridComponentPayloadOptions {
  [key: string]: unknown;
}

export interface RenderTemplateOptions {
  [key: string]: unknown;
}

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
export { handleUIResourceRead, createUIResourceHandler } from './ui-resource.handler';
export type { UIResourceHandleResult, UIResourceHandlerOptions, HandleUIResourceOptions } from './ui-resource.handler';

export { StaticWidgetResourceTemplate } from './ui-resource-template';
