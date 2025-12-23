// file: libs/browser/src/ui-resource/index.ts
/**
 * UI Resource Delivery module.
 *
 * This module provides utilities for creating HTML resources that can be
 * delivered to AI clients and linked from tool results.
 *
 * @example
 * ```typescript
 * import {
 *   createUIResource,
 *   createToolResultWithUI,
 *   safeHtml,
 *   renderToString,
 * } from '@frontmcp/browser';
 *
 * // Create a UI resource
 * const resource = createUIResource(
 *   safeHtml`<div class="chart">${chartTitle}</div>`,
 *   { description: 'Interactive chart' }
 * );
 *
 * // Register with server
 * server.addResource({
 *   uri: resource.uri,
 *   name: 'chart',
 *   mimeType: resource.mimeType,
 *   handler: () => resource.html,
 * });
 *
 * // Return tool result with UI link
 * return createToolResultWithUI({ data: chartData }, resource);
 * ```
 */

// Core utilities
export {
  createUIResource,
  createToolResultWithUI,
  wrapInDocument,
  minifyHtml,
  renderToString,
  escapeHtml,
  escapeScript,
  safeHtml,
  rawHtml,
  isUIResourceUri,
  extractResourceId,
  createResourceUri,
} from './ui-resource';

// Types
export type {
  CreateUIResourceOptions,
  UIResourceMimeType,
  UIResourceResult,
  ToolResultWithUI,
  RenderOptions,
  ComponentRenderer,
  RegisteredComponent,
} from './types';
