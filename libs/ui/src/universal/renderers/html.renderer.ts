/**
 * HTML Renderer
 *
 * Renders raw HTML strings using dangerouslySetInnerHTML.
 * Used for pre-rendered or server-side generated HTML content.
 */

import React from 'react';
import type { ClientRenderer, UniversalContent, RenderContext } from '../types';
import { sanitizeHtmlContent } from '@frontmcp/uipack/runtime';

/**
 * Re-export sanitizeHtmlContent as sanitizeHtml for backward compatibility.
 * Uses DOMPurify in browser environments for robust sanitization.
 */
export const sanitizeHtml = sanitizeHtmlContent;

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
 * Create a safe HTML renderer that sanitizes content.
 * Uses DOMPurify in browser environments for robust protection against XSS.
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
