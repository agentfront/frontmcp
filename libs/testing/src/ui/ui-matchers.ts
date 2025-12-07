/**
 * @file ui-matchers.ts
 * @description UI-specific Jest matchers for validating tool UI responses
 *
 * The metadata keys used in these matchers align with the UIMetadata interface
 * from @frontmcp/ui/adapters. Key fields include:
 * - `ui/html`: Inline rendered HTML (universal)
 * - `ui/mimeType`: MIME type for the HTML content
 * - `openai/outputTemplate`: Resource URI for widget template (OpenAI)
 * - `openai/widgetAccessible`: Whether widget can invoke tools (OpenAI)
 *
 * @see {@link https://docs.agentfront.dev/docs/servers/tools#tool-ui | Tool UI Documentation}
 *
 * @example
 * ```typescript
 * import { test, expect } from '@frontmcp/testing';
 *
 * test('tool has rendered UI', async ({ mcp }) => {
 *   const result = await mcp.tools.call('my-tool', {});
 *   expect(result).toHaveRenderedHtml();
 *   expect(result).toBeXssSafe();
 *   expect(result).toContainBoundValue('expected-value');
 * });
 * ```
 */

import type { MatcherFunction } from 'expect';
import type { ToolResultWrapper } from '../client/mcp-test-client.types';

// Type-only reference: Metadata keys used below align with UIMetadata from @frontmcp/ui/adapters
// This is an optional peer dependency, so we don't import it directly

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Escape special regex metacharacters in a string.
 * This prevents user-provided tag/class names from being interpreted as regex patterns.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract UI HTML from a tool result wrapper or raw result.
 */
function extractUiHtml(received: unknown): string | undefined {
  if (typeof received === 'string') {
    return received;
  }

  // ToolResultWrapper has raw._meta
  const wrapper = received as ToolResultWrapper & { _meta?: Record<string, unknown> };
  const meta = wrapper?.raw?._meta || wrapper?._meta;

  if (meta && typeof meta === 'object') {
    const uiHtml = (meta as Record<string, unknown>)['ui/html'];
    if (typeof uiHtml === 'string') {
      return uiHtml;
    }
  }

  return undefined;
}

/**
 * Extract _meta object from a tool result wrapper.
 */
function extractMeta(received: unknown): Record<string, unknown> | undefined {
  const wrapper = received as ToolResultWrapper & { _meta?: Record<string, unknown> };
  const meta = wrapper?.raw?._meta || wrapper?._meta;

  if (meta && typeof meta === 'object') {
    return meta as Record<string, unknown>;
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// UI MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if tool result has rendered HTML in _meta['ui/html'].
 * Fails if the HTML is the mdx-fallback (escaped raw content).
 */
const toHaveRenderedHtml: MatcherFunction<[]> = function (received) {
  const html = extractUiHtml(received);
  const hasHtml = html !== undefined && html.length > 0;
  const isFallback = hasHtml && html.includes('mdx-fallback');

  const pass = hasHtml && !isFallback;

  return {
    pass,
    message: () => {
      if (isFallback) {
        return 'Expected rendered HTML but got mdx-fallback (raw escaped content). MDX rendering may have failed.';
      }
      if (!hasHtml) {
        return 'Expected _meta to have ui/html property with rendered HTML';
      }
      return 'Expected result not to have rendered HTML';
    },
  };
};

/**
 * Check if HTML contains a specific HTML element tag.
 * @param tag - The HTML tag name to look for (e.g., 'div', 'h1', 'span')
 */
const toContainHtmlElement: MatcherFunction<[tag: string]> = function (received, tag) {
  const html = extractUiHtml(received);

  if (!html) {
    return {
      pass: false,
      message: () => `Expected to find <${tag}> element, but no HTML content found`,
    };
  }

  // Match opening tags: <tag> or <tag attributes>
  // Escape regex metacharacters to prevent user input from breaking the regex
  const regex = new RegExp(`<${escapeRegex(tag)}[\\s>]`, 'i');
  const pass = regex.test(html);

  return {
    pass,
    message: () =>
      pass ? `Expected HTML not to contain <${tag}> element` : `Expected HTML to contain <${tag}> element`,
  };
};

/**
 * Check if a bound value from tool output appears in the rendered HTML.
 * @param value - The value to look for (string or number)
 */
const toContainBoundValue: MatcherFunction<[value: string | number]> = function (received, value) {
  const html = extractUiHtml(received);

  if (!html) {
    return {
      pass: false,
      message: () => `Expected HTML to contain bound value "${value}", but no HTML content found`,
    };
  }

  const stringValue = String(value);
  const pass = html.includes(stringValue);

  return {
    pass,
    message: () =>
      pass
        ? `Expected HTML not to contain bound value "${stringValue}"`
        : `Expected HTML to contain bound value "${stringValue}"`,
  };
};

/**
 * Check if HTML is XSS-safe (no script tags, event handlers, or javascript: URIs).
 */
const toBeXssSafe: MatcherFunction<[]> = function (received) {
  const html = extractUiHtml(received);

  if (!html) {
    // No HTML means nothing to exploit
    return {
      pass: true,
      message: () => 'Expected HTML to be XSS unsafe (no HTML found)',
    };
  }

  const hasScript = /<script[\s>]/i.test(html);
  const hasOnHandler = /\son\w+\s*=/i.test(html);
  const hasJavascriptUri = /javascript:/i.test(html);

  const issues: string[] = [];
  if (hasScript) issues.push('<script> tag');
  if (hasOnHandler) issues.push('inline event handler (onclick, etc.)');
  if (hasJavascriptUri) issues.push('javascript: URI');

  const pass = !hasScript && !hasOnHandler && !hasJavascriptUri;

  return {
    pass,
    message: () =>
      pass ? 'Expected HTML not to be XSS safe' : `Expected HTML to be XSS safe, but found: ${issues.join(', ')}`,
  };
};

/**
 * Check if tool result has widget metadata.
 * Checks for ui/html (universal), openai/outputTemplate, or ui/mimeType.
 */
const toHaveWidgetMetadata: MatcherFunction<[]> = function (received) {
  const meta = extractMeta(received);

  if (!meta) {
    return {
      pass: false,
      message: () => 'Expected _meta to have widget metadata, but no _meta found',
    };
  }

  // Check for any widget-related metadata fields
  const hasUiHtml = Boolean(meta['ui/html']);
  const hasOutputTemplate = Boolean(meta['openai/outputTemplate']);
  const hasMimeType = Boolean(meta['ui/mimeType']);

  const pass = hasUiHtml || hasOutputTemplate || hasMimeType;

  return {
    pass,
    message: () =>
      pass
        ? 'Expected result not to have widget metadata'
        : 'Expected _meta to have widget metadata (ui/html, openai/outputTemplate, or ui/mimeType)',
  };
};

/**
 * Check if HTML has CSS classes (for styling validation).
 * @param className - The CSS class name to look for
 */
const toHaveCssClass: MatcherFunction<[className: string]> = function (received, className) {
  const html = extractUiHtml(received);

  if (!html) {
    return {
      pass: false,
      message: () => `Expected HTML to have CSS class "${className}", but no HTML content found`,
    };
  }

  // Match class="... className ..." or className="... className ..."
  // Escape regex metacharacters to prevent user input from breaking the regex
  const classRegex = new RegExp(`class(?:Name)?\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["']`, 'i');
  const pass = classRegex.test(html);

  return {
    pass,
    message: () =>
      pass ? `Expected HTML not to have CSS class "${className}"` : `Expected HTML to have CSS class "${className}"`,
  };
};

/**
 * Check that HTML does NOT contain specific content (useful for fallback checks).
 * @param content - The content that should NOT be in the HTML
 */
const toNotContainRawContent: MatcherFunction<[content: string]> = function (received, content) {
  const html = extractUiHtml(received);

  if (!html) {
    return {
      pass: true,
      message: () => `Expected HTML to contain raw content "${content}", but no HTML found`,
    };
  }

  const pass = !html.includes(content);

  return {
    pass,
    message: () =>
      pass
        ? `Expected HTML to contain raw content "${content}"`
        : `Expected HTML not to contain raw content "${content}" (may indicate rendering failure)`,
  };
};

/**
 * Check if HTML has proper structure (not just escaped text).
 */
const toHaveProperHtmlStructure: MatcherFunction<[]> = function (received) {
  const html = extractUiHtml(received);

  if (!html) {
    return {
      pass: false,
      message: () => 'Expected proper HTML structure, but no HTML content found',
    };
  }

  // Check for escaped HTML entities that suggest content wasn't rendered
  const hasEscapedTags = html.includes('&lt;') && html.includes('&gt;');

  // Check that there's at least one HTML tag
  const hasHtmlTags = /<[a-z]/i.test(html);

  const pass = hasHtmlTags && !hasEscapedTags;

  return {
    pass,
    message: () => {
      if (hasEscapedTags) {
        return 'Expected proper HTML structure, but found escaped HTML entities - content may not have been rendered';
      }
      if (!hasHtmlTags) {
        return 'Expected proper HTML structure, but found no HTML tags';
      }
      return 'Expected result not to have proper HTML structure';
    },
  };
};

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * All UI matchers as an object for expect.extend()
 */
export const uiMatchers = {
  toHaveRenderedHtml,
  toContainHtmlElement,
  toContainBoundValue,
  toBeXssSafe,
  toHaveWidgetMetadata,
  toHaveCssClass,
  toNotContainRawContent,
  toHaveProperHtmlStructure,
};
