// file: libs/browser/src/ui-resource/ui-resource.ts
/**
 * UI Resource helper for creating HTML resources for AI clients.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type { CreateUIResourceOptions, UIResourceResult, ToolResultWithUI, RenderOptions } from './types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MIME_TYPE = 'text/html';
const UI_RESOURCE_PREFIX = 'ui://render/';

// =============================================================================
// Create UI Resource
// =============================================================================

/**
 * Create a UI resource with HTML content.
 *
 * This function generates a resource that can be registered with the MCP server
 * and linked to tool results via the _meta.resourceUri field.
 *
 * @example
 * ```typescript
 * import { createUIResource } from '@frontmcp/browser';
 *
 * const resource = createUIResource('<div>Hello World</div>', {
 *   description: 'A greeting message',
 * });
 *
 * // Register with server
 * server.addResource({
 *   uri: resource.uri,
 *   name: 'greeting',
 *   mimeType: resource.mimeType,
 *   handler: () => resource.html,
 * });
 *
 * // Return from tool with UI link
 * return {
 *   content: { message: 'Greeting created' },
 *   _meta: resource._meta,
 * };
 * ```
 */
export function createUIResource(html: string, options: CreateUIResourceOptions = {}): UIResourceResult {
  const id = generateUUID();
  const uri = `${UI_RESOURCE_PREFIX}${id}`;
  const mimeType = options.mimeType ?? DEFAULT_MIME_TYPE;

  // Wrap content with styles/scripts if provided
  let finalHtml = html;
  if (options.styles || options.scripts) {
    const parts: string[] = [];

    if (options.styles) {
      parts.push(`<style>${options.styles}</style>`);
    }

    parts.push(html);

    if (options.scripts) {
      parts.push(`<script>${options.scripts}</script>`);
    }

    finalHtml = parts.join('\n');
  }

  return {
    uri,
    html: finalHtml,
    mimeType,
    _meta: {
      resourceUri: uri,
      mimeType,
    },
  };
}

// =============================================================================
// Create Tool Result with UI
// =============================================================================

/**
 * Create a tool result that includes a link to a UI resource.
 *
 * @example
 * ```typescript
 * const resource = createUIResource('<div>Chart</div>');
 *
 * // In tool handler:
 * return createToolResultWithUI({ data: chartData }, resource);
 * ```
 */
export function createToolResultWithUI<T>(content: T, resource: UIResourceResult): ToolResultWithUI<T> {
  return {
    content,
    _meta: resource._meta,
  };
}

// =============================================================================
// Render to String Utilities
// =============================================================================

/**
 * Wrap HTML content in a full document structure.
 *
 * @example
 * ```typescript
 * const html = wrapInDocument('<div>Content</div>', {
 *   title: 'My Page',
 *   css: 'body { font-family: sans-serif; }',
 * });
 * ```
 */
export function wrapInDocument(content: string, options: RenderOptions = {}): string {
  const { title = 'UI Resource', css = '', js = '' } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${css ? `<style>${css}</style>` : ''}
</head>
<body>
  ${content}
  ${js ? `<script>${js}</script>` : ''}
</body>
</html>`;
}

/**
 * Render a string with minimal minification.
 */
export function minifyHtml(html: string): string {
  return html
    .replace(/>\s+</g, '><') // Remove whitespace between tags
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Render HTML with optional document wrapping.
 */
export function renderToString(content: string, options: RenderOptions = {}): string {
  let result = content;

  if (options.fullDocument) {
    result = wrapInDocument(result, options);
  }

  if (options.minify) {
    result = minifyHtml(result);
  }

  return result;
}

// =============================================================================
// HTML Escaping
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  };

  return str.replace(/[&<>"']/g, (char) => escapeMap[char]);
}

/**
 * Escape content for use inside a <script> tag.
 */
export function escapeScript(str: string): string {
  return str.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

// =============================================================================
// Template Literals
// =============================================================================

/**
 * Tagged template literal for safe HTML construction.
 *
 * @example
 * ```typescript
 * const userInput = '<script>alert("xss")</script>';
 * const html = safeHtml`<div>${userInput}</div>`;
 * // Result: <div>&lt;script&gt;alert("xss")&lt;/script&gt;</div>
 * ```
 */
export function safeHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    const value = values[i];
    const escaped = value !== undefined && value !== null ? escapeHtml(String(value)) : '';
    return result + str + escaped;
  }, '');
}

/**
 * Tagged template literal that allows raw HTML interpolation.
 * Use with caution - only for trusted content.
 *
 * @example
 * ```typescript
 * const trusted = '<strong>Bold</strong>';
 * const html = rawHtml`<div>${trusted}</div>`;
 * // Result: <div><strong>Bold</strong></div>
 * ```
 */
export function rawHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    const value = values[i] ?? '';
    return result + str + String(value);
  }, '');
}

// =============================================================================
// URI Utilities
// =============================================================================

/**
 * Check if a URI is a UI resource URI.
 */
export function isUIResourceUri(uri: string): boolean {
  return uri.startsWith(UI_RESOURCE_PREFIX);
}

/**
 * Extract the resource ID from a UI resource URI.
 */
export function extractResourceId(uri: string): string | null {
  if (!isUIResourceUri(uri)) {
    return null;
  }
  return uri.slice(UI_RESOURCE_PREFIX.length);
}

/**
 * Create a UI resource URI from an ID.
 */
export function createResourceUri(id: string): string {
  return `${UI_RESOURCE_PREFIX}${id}`;
}
