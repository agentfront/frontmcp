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
 * List of all HTML event handler attributes to remove.
 * Complete list per HTML5 spec.
 */
const EVENT_HANDLERS = [
  'onabort',
  'onafterprint',
  'onauxclick',
  'onbeforematch',
  'onbeforeprint',
  'onbeforetoggle',
  'onbeforeunload',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextlost',
  'oncontextmenu',
  'oncontextrestored',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onemptied',
  'onended',
  'onerror',
  'onfocus',
  'onformdata',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onlanguagechange',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onmessage',
  'onmessageerror',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onoffline',
  'ononline',
  'onpagehide',
  'onpageshow',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onrejectionhandled',
  'onreset',
  'onresize',
  'onscroll',
  'onscrollend',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onslotchange',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'onunhandledrejection',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwheel',
];

/**
 * Dangerous tags to completely remove.
 */
const DANGEROUS_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'base'];

/**
 * Dangerous URL schemes.
 */
const DANGEROUS_SCHEMES = ['javascript', 'data', 'vbscript'];

/**
 * Sanitize HTML string using character-by-character parsing.
 * This approach avoids ReDoS vulnerabilities and handles edge cases
 * like HTML entity encoded event handlers.
 *
 * For production use with untrusted input, consider using DOMPurify.
 *
 * @param html - HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  // First pass: decode HTML entities that might bypass detection
  const decoded = decodeHtmlEntities(html);

  // Parse and sanitize using safe character-by-character approach
  return parseAndSanitize(decoded);
}

/**
 * Decode common HTML entities that could bypass sanitization.
 * IMPORTANT: &amp; must be decoded LAST to prevent double-unescaping attacks.
 * Otherwise, &amp;lt; would become &lt; then <, bypassing sanitization.
 */
function decodeHtmlEntities(html: string): string {
  return (
    html
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      // MUST be last to prevent double-unescaping (e.g., &amp;lt; -> &lt; -> <)
      .replace(/&amp;/gi, '&')
  );
}

/**
 * Parse HTML and remove dangerous elements/attributes.
 * Uses character-by-character parsing to avoid regex backtracking.
 */
function parseAndSanitize(html: string): string {
  const result: string[] = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] === '<') {
      // Parse tag
      const tagResult = parseTag(html, i);
      if (tagResult) {
        const { tag, end, isClosing, isSelfClosing } = tagResult;
        const tagLower = tag.toLowerCase();

        // Skip dangerous tags entirely (including their content for opening tags)
        if (DANGEROUS_TAGS.includes(tagLower)) {
          if (!isClosing && !isSelfClosing) {
            // Skip to closing tag
            const closeTag = `</${tagLower}`;
            const closeIndex = html.toLowerCase().indexOf(closeTag, end);
            if (closeIndex !== -1) {
              // Find the end of the closing tag
              const closeEnd = html.indexOf('>', closeIndex);
              i = closeEnd !== -1 ? closeEnd + 1 : end;
            } else {
              i = end;
            }
          } else {
            i = end;
          }
          continue;
        }

        // Process attributes for safe tags
        const sanitizedTag = sanitizeTagAttributes(html.slice(i, end));
        result.push(sanitizedTag);
        i = end;
      } else {
        result.push(html[i]);
        i++;
      }
    } else {
      result.push(html[i]);
      i++;
    }
  }

  return result.join('');
}

/**
 * Parse a single HTML tag and return its details.
 */
function parseTag(
  html: string,
  start: number,
): { tag: string; end: number; isClosing: boolean; isSelfClosing: boolean } | null {
  if (html[start] !== '<') return null;

  let i = start + 1;
  const len = html.length;

  // Skip whitespace
  while (i < len && (html[i] === ' ' || html[i] === '\t' || html[i] === '\n')) i++;

  const isClosing = html[i] === '/';
  if (isClosing) i++;

  // Skip whitespace after /
  while (i < len && (html[i] === ' ' || html[i] === '\t' || html[i] === '\n')) i++;

  // Parse tag name
  const tagStart = i;
  while (i < len && /[a-zA-Z0-9]/.test(html[i])) i++;
  const tag = html.slice(tagStart, i);

  if (!tag) return null;

  // Find end of tag
  let inQuote: string | null = null;
  while (i < len) {
    if (inQuote) {
      if (html[i] === inQuote) inQuote = null;
    } else {
      if (html[i] === '"' || html[i] === "'") {
        inQuote = html[i];
      } else if (html[i] === '>') {
        const isSelfClosing = i > 0 && html[i - 1] === '/';
        return { tag, end: i + 1, isClosing, isSelfClosing };
      }
    }
    i++;
  }

  return null;
}

/**
 * Sanitize attributes within a tag string.
 */
function sanitizeTagAttributes(tagStr: string): string {
  // Find where attributes start (after tag name)
  const match = tagStr.match(/^<\/?([a-zA-Z0-9]+)/);
  if (!match) return tagStr;

  const tagName = match[1];
  const afterTagName = tagStr.slice(match[0].length);

  // Parse attributes
  const sanitizedAttrs = parseAndSanitizeAttributes(afterTagName);

  // Handle self-closing
  const selfClose = tagStr.trimEnd().endsWith('/>') ? ' /' : '';
  const closeBracket = tagStr.includes('</') ? '' : '>';

  if (tagStr.startsWith('</')) {
    return `</${tagName}${closeBracket}`;
  }

  return `<${tagName}${sanitizedAttrs}${selfClose}>`;
}

/**
 * Parse and sanitize attributes, removing dangerous ones.
 */
function parseAndSanitizeAttributes(attrStr: string): string {
  const result: string[] = [];
  let i = 0;
  const len = attrStr.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(attrStr[i])) i++;
    if (i >= len || attrStr[i] === '>' || (attrStr[i] === '/' && attrStr[i + 1] === '>')) break;

    // Parse attribute name
    const attrStart = i;
    while (i < len && /[a-zA-Z0-9_-]/.test(attrStr[i])) i++;
    const attrName = attrStr.slice(attrStart, i).toLowerCase();

    if (!attrName) {
      i++;
      continue;
    }

    // Skip whitespace
    while (i < len && /\s/.test(attrStr[i])) i++;

    let attrValue = '';
    let quote = '';

    // Check for value
    if (i < len && attrStr[i] === '=') {
      i++; // skip '='

      // Skip whitespace
      while (i < len && /\s/.test(attrStr[i])) i++;

      // Parse value
      if (i < len && (attrStr[i] === '"' || attrStr[i] === "'")) {
        quote = attrStr[i];
        i++; // skip opening quote
        const valueStart = i;
        while (i < len && attrStr[i] !== quote) i++;
        attrValue = attrStr.slice(valueStart, i);
        if (i < len) i++; // skip closing quote
      } else {
        // Unquoted value
        const valueStart = i;
        while (i < len && !/[\s>]/.test(attrStr[i])) i++;
        attrValue = attrStr.slice(valueStart, i);
      }
    }

    // Check if attribute is safe
    if (isAttributeSafe(attrName, attrValue)) {
      if (attrValue) {
        result.push(` ${attrName}="${escapeAttrValue(attrValue)}"`);
      } else {
        result.push(` ${attrName}`);
      }
    }
  }

  return result.join('');
}

/**
 * Check if an attribute is safe to include.
 */
function isAttributeSafe(name: string, value: string): boolean {
  const nameLower = name.toLowerCase();

  // Block event handlers (including variations)
  if (nameLower.startsWith('on')) {
    return false;
  }

  // Block known event handlers with entity encoding
  if (EVENT_HANDLERS.some((h) => nameLower === h)) {
    return false;
  }

  // Check URL attributes for dangerous schemes
  const urlAttrs = ['href', 'src', 'action', 'formaction', 'data', 'poster', 'codebase'];
  if (urlAttrs.includes(nameLower)) {
    const valueLower = value.toLowerCase().trim();
    // Check for dangerous schemes (with possible whitespace/entities)
    for (const scheme of DANGEROUS_SCHEMES) {
      if (valueLower.startsWith(scheme + ':') || valueLower.startsWith(scheme + ' :')) {
        return false;
      }
    }
  }

  // Block style attribute that could contain dangerous expressions
  if (nameLower === 'style') {
    const valueLower = value.toLowerCase();
    if (valueLower.includes('expression(') || valueLower.includes('javascript:') || valueLower.includes('url(')) {
      return false;
    }
  }

  return true;
}

/**
 * Escape attribute value for safe inclusion.
 */
function escapeAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
