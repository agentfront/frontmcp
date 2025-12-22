/**
 * MDX Renderer
 *
 * Renders MDX content (Markdown + JSX) using @mdx-js/react.
 * Supports custom components for enhanced rendering.
 */

import React from 'react';
import type { ClientRenderer, UniversalContent, RenderContext } from '../types';
import { escapeHtml } from '@frontmcp/uipack/utils';

/**
 * Check if MDX runtime is available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMDXRuntime(): { MDXProvider: React.ComponentType<any> } | null {
  // Check window global (browser runtime)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).MDXProvider) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { MDXProvider: (window as any).MDXProvider };
  }
  return null;
}

/**
 * Check if content contains MDX syntax.
 */
function containsMdxSyntax(source: string): boolean {
  // JSX component tags
  if (/<[A-Z][a-zA-Z]*/.test(source)) {
    return true;
  }

  // JS expressions in curly braces
  if (/\{[^}"']+\}/.test(source)) {
    return true;
  }

  // Import/export statements
  if (/^(import|export)\s/m.test(source)) {
    return true;
  }

  // JSX-specific attributes
  if (/\s(className|onClick|onChange)=/.test(source)) {
    return true;
  }

  return false;
}

/**
 * MDX renderer implementation.
 *
 * Uses @mdx-js/react when available. Falls back to warning when MDX
 * cannot be rendered (e.g., on Claude which only supports cdnjs).
 *
 * @example
 * ```tsx
 * const content: UniversalContent = {
 *   type: 'mdx',
 *   source: '# Hello\n\n<WeatherCard temp={72} />',
 *   components: { WeatherCard },
 * };
 * ```
 */
export const mdxRenderer: ClientRenderer = {
  type: 'mdx',
  priority: 20, // Higher than markdown, lower than React

  canHandle(content: UniversalContent): boolean {
    if (content.type === 'mdx') {
      return true;
    }

    // Auto-detect MDX in strings (has both markdown and JSX)
    if (typeof content.source === 'string') {
      const source = content.source;
      const hasMarkdown =
        /^#{1,6}\s/m.test(source) || /^\*\s/m.test(source) || /^-\s/m.test(source) || /^\d+\.\s/m.test(source);

      return hasMarkdown && containsMdxSyntax(source);
    }

    return false;
  },

  render(content: UniversalContent, context: RenderContext): React.ReactNode {
    const source = content.source;

    if (typeof source !== 'string') {
      return React.createElement('div', { className: 'frontmcp-error' }, 'MDX renderer requires a string source');
    }

    // Try to get MDX runtime
    const mdxRuntime = getMDXRuntime();

    if (!mdxRuntime) {
      // MDX not available - show warning and fallback
      console.warn('[FrontMCP] MDX runtime not available. Content will be displayed as-is.');

      // Fall back to rendering as HTML using the centralized escapeHtml utility
      const escapedContent = escapeHtml(source).replace(/\n/g, '<br>');

      return React.createElement(
        'div',
        { className: 'frontmcp-mdx-fallback' },
        React.createElement(
          'div',
          {
            key: 'warning',
            className:
              'frontmcp-warning bg-yellow-50 border border-yellow-200 rounded p-2 mb-4 text-sm text-yellow-800',
          },
          'MDX rendering is not available on this platform. Content is shown as raw text.',
        ),
        React.createElement('pre', {
          key: 'content',
          className: 'bg-gray-100 p-4 rounded overflow-auto',
          dangerouslySetInnerHTML: { __html: escapedContent },
        }),
      );
    }

    // Merge components from content and context
    const components = {
      ...context.components,
      ...content.components,
    };

    // Note: In a real implementation, the MDX content would need to be
    // compiled first (either at build time or runtime with @mdx-js/mdx).
    // For the browser runtime, we expect the MDX to be pre-compiled to
    // a component function.

    // If source is already a compiled component (from build step)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (content as any).compiledContent === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CompiledContent = (content as any).compiledContent;

      return React.createElement(
        mdxRuntime.MDXProvider,
        { components },
        React.createElement(CompiledContent, {
          output: context.output,
          input: context.input,
        }),
      );
    }

    // For uncompiled MDX strings, show the fallback
    // Runtime MDX compilation is complex and adds significant bundle size
    console.warn('[FrontMCP] MDX content needs to be pre-compiled. Raw MDX string rendering is not supported.');

    return React.createElement(
      'div',
      { className: 'frontmcp-mdx-uncompiled' },
      React.createElement('pre', { className: 'bg-gray-100 p-4 rounded overflow-auto text-sm' }, source),
    );
  },
};

/**
 * Check if MDX rendering is supported on the current platform.
 *
 * @returns True if MDX can be rendered
 */
export function isMdxSupported(): boolean {
  return getMDXRuntime() !== null;
}

/**
 * Create an MDX renderer with pre-configured components.
 *
 * @param defaultComponents - Default components for MDX
 * @returns Configured MDX renderer
 */
export function createMdxRenderer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultComponents: Record<string, React.ComponentType<any>>,
): ClientRenderer {
  return {
    ...mdxRenderer,
    render(content: UniversalContent, context: RenderContext): React.ReactNode {
      const enhancedContext: RenderContext = {
        ...context,
        components: {
          ...defaultComponents,
          ...context.components,
        },
      };

      return mdxRenderer.render(content, enhancedContext);
    },
  };
}
