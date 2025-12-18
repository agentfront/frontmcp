/**
 * Markdown Renderer
 *
 * Renders Markdown content using react-markdown.
 * Supports custom components for enhanced rendering.
 */

import React from 'react';
import type { ClientRenderer, UniversalContent, RenderContext } from '../types';

/**
 * Check if react-markdown is available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReactMarkdown(): React.ComponentType<any> | null {
  // Check window global (browser runtime)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).ReactMarkdown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).ReactMarkdown;
  }
  return null;
}

/**
 * Minimal inline markdown parser for platforms without react-markdown.
 * Supports: headers, bold, italic, links, code, lists.
 */
function parseMarkdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Headers (h1-h6)
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>');

  // Line breaks / paragraphs
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');

  return html;
}

/**
 * Markdown renderer implementation.
 *
 * Uses react-markdown when available, falls back to minimal inline parser.
 *
 * @example
 * ```tsx
 * const content: UniversalContent = {
 *   type: 'markdown',
 *   source: '# Hello\n\nThis is **bold** text.',
 *   components: { a: CustomLink },
 * };
 *
 * // Renders: <h1>Hello</h1><p>This is <strong>bold</strong> text.</p>
 * ```
 */
export const markdownRenderer: ClientRenderer = {
  type: 'markdown',
  priority: 10, // Medium priority

  canHandle(content: UniversalContent): boolean {
    if (content.type === 'markdown') {
      return true;
    }

    // Auto-detect markdown in strings
    if (typeof content.source === 'string') {
      const source = content.source;
      // Check for markdown patterns
      const hasMarkdown =
        /^#{1,6}\s/m.test(source) || // Headers
        /^\*\s/m.test(source) || // Unordered list
        /^-\s/m.test(source) || // Unordered list
        /^\d+\.\s/m.test(source) || // Ordered list
        /\*\*[^*]+\*\*/.test(source) || // Bold
        /\[[^\]]+\]\([^)]+\)/.test(source); // Links

      // Must have markdown but NOT JSX tags
      const hasJsx = /<[A-Z][a-zA-Z]*/.test(source);

      return hasMarkdown && !hasJsx;
    }

    return false;
  },

  render(content: UniversalContent, context: RenderContext): React.ReactNode {
    const source = content.source;

    if (typeof source !== 'string') {
      return React.createElement('div', {
        className: 'frontmcp-error',
        children: 'Markdown renderer requires a string source',
      });
    }

    // Try to use react-markdown
    const ReactMarkdown = getReactMarkdown();

    if (ReactMarkdown) {
      // Merge components from content and context
      const components = {
        ...context.components,
        ...content.components,
      };

      return React.createElement(ReactMarkdown, {
        children: source,
        components,
      });
    }

    // Fallback: minimal inline parser
    const html = parseMarkdownToHtml(source);

    return React.createElement('div', {
      className: 'frontmcp-markdown-content prose',
      dangerouslySetInnerHTML: { __html: html },
    });
  },
};

/**
 * Create a markdown renderer with custom default components.
 *
 * @param defaultComponents - Default components to use
 * @returns Configured markdown renderer
 */
export function createMarkdownRenderer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultComponents: Record<string, React.ComponentType<any>>,
): ClientRenderer {
  return {
    ...markdownRenderer,
    render(content: UniversalContent, context: RenderContext): React.ReactNode {
      // Inject default components
      const enhancedContext: RenderContext = {
        ...context,
        components: {
          ...defaultComponents,
          ...context.components,
        },
      };

      return markdownRenderer.render(content, enhancedContext);
    },
  };
}
