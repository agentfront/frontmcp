/**
 * HTML Renderer
 *
 * Renders raw HTML strings using dangerouslySetInnerHTML.
 * Used for pre-rendered or server-side generated HTML content.
 */

import React from 'react';
import type { ClientRenderer, UniversalContent, RenderContext } from '../types';

/**
 * HTML renderer implementation.
 *
 * Renders HTML strings directly to the DOM using dangerouslySetInnerHTML.
 * This is the lowest priority renderer (fallback).
 *
 * @example
 * ```tsx
 * const content: UniversalContent = {
 *   type: 'html',
 *   source: '<div class="card"><h1>Hello</h1></div>',
 * };
 *
 * // Renders: <div class="card"><h1>Hello</h1></div>
 * ```
 */
export const htmlRenderer: ClientRenderer = {
  type: 'html',
  priority: 0, // Lowest priority (fallback)

  canHandle(content: UniversalContent): boolean {
    return content.type === 'html' || typeof content.source === 'string';
  },

  render(content: UniversalContent, _context: RenderContext): React.ReactNode {
    const source = content.source;

    // Must be a string for HTML rendering
    if (typeof source !== 'string') {
      return React.createElement('div', { className: 'frontmcp-error' }, 'HTML renderer requires a string source');
    }

    // Render using dangerouslySetInnerHTML
    return React.createElement('div', {
      className: 'frontmcp-html-content',
      dangerouslySetInnerHTML: { __html: source },
    });
  },
};

/**
 * Sanitize HTML string (basic XSS protection).
 * For production use, consider using a library like DOMPurify.
 *
 * @param html - HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  // Remove script tags
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  return sanitized;
}

/**
 * Create a safe HTML renderer that sanitizes content.
 */
export const safeHtmlRenderer: ClientRenderer = {
  type: 'html',
  priority: 0,

  canHandle(content: UniversalContent): boolean {
    return content.type === 'html' && typeof content.source === 'string';
  },

  render(content: UniversalContent, _context: RenderContext): React.ReactNode {
    const source = content.source;

    if (typeof source !== 'string') {
      return React.createElement('div', { className: 'frontmcp-error' }, 'HTML renderer requires a string source');
    }

    const sanitized = sanitizeHtml(source);

    return React.createElement('div', {
      className: 'frontmcp-html-content',
      dangerouslySetInnerHTML: { __html: sanitized },
    });
  },
};
