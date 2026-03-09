/**
 * Tool UI Module
 *
 * Provides UI template rendering and platform-specific metadata generation
 * for MCP tool responses.
 *
 * Delegates to @frontmcp/uipack/adapters for rendering, content detection,
 * and protocol-aligned response formatting.
 */

import { detectUIType, renderToolTemplate as uipackRenderToolTemplate } from '@frontmcp/uipack/adapters';

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
// Registry functions (delegating to @frontmcp/uipack)
// ============================================

export function renderToolTemplateAsync(
  toolName: string,
  input: unknown,
  output: unknown,
  template: unknown,
  platformType?: string,
): Promise<string> {
  const result = uipackRenderToolTemplate({ toolName, input, output, template, platformType });
  return Promise.resolve(result.html);
}

export function renderToolTemplate(
  toolName: string,
  input: unknown,
  output: unknown,
  template: unknown,
  platformType?: string,
): string {
  const result = uipackRenderToolTemplate({ toolName, input, output, template, platformType });
  return result.html;
}

/** Check if a tool entry has UI configuration */
export function hasUIConfig(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool === null) return false;
  const metadata = (tool as Record<string, unknown>)['ui'];
  return metadata !== undefined && metadata !== null;
}

export function isReactComponent(template: unknown): boolean {
  return detectUIType(template) === 'react';
}

export function containsMdxSyntax(content: string): boolean {
  // MDX markers: import/export statements, JSX in markdown
  return /^(import|export)\s/m.test(content) || /<[A-Z]/.test(content);
}

// Types for registry operations
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
