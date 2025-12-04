/**
 * Template Rendering
 *
 * Executes tool UI templates with proper context and helpers.
 * Supports sync rendering for HTML strings/template functions,
 * async rendering for React components via SSR, and MDX rendering.
 */

import type { ToolUIConfig, TemplateContext, TemplateBuilderFn } from '../../common/metadata/tool-ui.metadata';
import { createTemplateHelpers } from './template-helpers';

/**
 * Check if a string contains MDX syntax (Markdown + JSX).
 *
 * Looks for:
 * - JSX component tags (PascalCase): `<Component />`
 * - JS expressions: `{variable}` or `{items.map(...)}`
 * - Import/export statements
 * - Frontmatter: `---\n...\n---`
 */
function containsMdxSyntax(source: string): boolean {
  // Has JSX component tags (PascalCase)
  if (/<[A-Z][a-zA-Z0-9]*/.test(source)) {
    return true;
  }

  // Has import/export statements (ESM)
  if (/^(import|export)\s/m.test(source)) {
    return true;
  }

  // Has JSX-specific attributes (className, onClick, etc.)
  // These are only valid in JSX, not in regular HTML
  if (/\s(className|onClick|onChange|onSubmit|htmlFor|dangerouslySetInnerHTML)=/.test(source)) {
    return true;
  }

  // Has JS expressions in curly braces (not just HTML attributes)
  if (/\{[^}"'\n]*\}/.test(source) && !/=\s*["'][^"']*\{/.test(source)) {
    return true;
  }

  // Has frontmatter
  if (/^---[\s\S]*?---/m.test(source)) {
    return true;
  }

  // Has Markdown headers with JSX or expressions
  if (/^#{1,6}\s.*\{.*\}/m.test(source)) {
    return true;
  }

  // Has JSX fragments
  if (/<>|<\/>/.test(source)) {
    return true;
  }

  return false;
}

/**
 * Render MDX content to HTML string.
 *
 * Dynamically imports the MDX renderer from @frontmcp/ui.
 * Falls back to plain text if MDX rendering is not available.
 */
async function renderMdxContent<In, Out>(
  mdxContent: string,
  context: TemplateContext<In, Out>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, any>,
): Promise<string> {
  try {
    // Dynamically import the MDX renderer
    const { mdxRenderer } = await import('@frontmcp/ui');

    // Render MDX to HTML with custom components
    const html = await mdxRenderer.render(mdxContent, context, { mdxComponents });
    return html;
  } catch (error) {
    // If MDX rendering fails, warn and return escaped content
    console.error(
      '[@frontmcp/sdk] MDX rendering failed:',
      error instanceof Error ? error.stack || error.message : String(error),
    );

    // Return the raw MDX as escaped HTML (fallback)
    const escaped = mdxContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="mdx-fallback">${escaped}</pre>`;
  }
}

/**
 * Check if a template is a React component (not a template builder function).
 *
 * React components are distinguished from template builder functions by:
 * - Having $$typeof symbol (React.memo, forwardRef, etc.)
 * - Having prototype.isReactComponent (class components)
 * - PascalCase naming convention (function components)
 *
 * Template builder functions take (ctx) and return a string, while
 * React components take props and return JSX.Element.
 */
export function isReactComponent(template: unknown): boolean {
  if (typeof template !== 'function') return false;

  // Template builder functions take (ctx) and return string
  // React components have different signatures

  // Check for React component markers
  const fn = template as Function & {
    $$typeof?: symbol;
    displayName?: string;
    render?: Function;
    prototype?: { isReactComponent?: boolean };
  };

  // React.memo, forwardRef, etc. have $$typeof
  if (fn.$$typeof) return true;

  // Class components have prototype.isReactComponent
  if (fn.prototype?.isReactComponent) return true;

  // Function components: PascalCase name convention
  // This is a heuristic - function names starting with uppercase are likely React components
  if (fn.name && /^[A-Z]/.test(fn.name)) return true;

  return false;
}

/**
 * Options for rendering a tool template.
 */
export interface RenderTemplateOptions {
  /** The template configuration from the tool */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: TemplateBuilderFn<unknown, unknown> | string | ((props: any) => any);
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool output (raw result from execute) */
  output: unknown;
  /** Structured content parsed from output */
  structuredContent?: unknown;
  /** Custom MDX components to use in MDX templates */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, any>;
}

/**
 * Render a tool UI template.
 *
 * @param options - Template and context data
 * @returns Rendered HTML string
 * @throws Error if template execution fails
 */
export function renderToolTemplate(options: RenderTemplateOptions): string {
  const { template, input, output, structuredContent } = options;

  // If template is already a string, return it directly
  if (typeof template === 'string') {
    return template;
  }

  // Create template context with helpers
  const ctx: TemplateContext<Record<string, unknown>, unknown> = {
    input,
    output,
    structuredContent,
    helpers: createTemplateHelpers(),
  };

  // Execute the template function
  try {
    return template(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Template rendering failed: ${message}`);
  }
}

/**
 * Check if a tool has UI configuration.
 * Uses loose typing to handle variance issues with generic tool metadata.
 */
export function hasUIConfig(metadata: { ui?: unknown }): metadata is { ui: ToolUIConfig<unknown, unknown> } {
  const ui = metadata.ui as ToolUIConfig<unknown, unknown> | undefined;
  return ui !== undefined && ui.template !== undefined;
}

/**
 * Render a tool UI template asynchronously.
 *
 * This version supports:
 * - React components via SSR
 * - MDX strings (Markdown + JSX) via @mdx-js/mdx
 * - HTML strings and template builder functions
 *
 * For React components:
 * - Dynamically imports react and react-dom/server
 * - Uses renderToString for SSR
 * - React components receive the template context as props
 *
 * For MDX templates:
 * - Detects MDX syntax (Markdown headers, JSX components, expressions)
 * - Compiles and renders via @frontmcp/ui's MDX renderer
 *
 * @param options - Template and context data
 * @returns Promise resolving to rendered HTML string
 * @throws Error if template execution or rendering fails
 */
export async function renderToolTemplateAsync(options: RenderTemplateOptions): Promise<string> {
  const { template, input, output, structuredContent, mdxComponents } = options;

  // Create template context with helpers
  const ctx: TemplateContext<Record<string, unknown>, unknown> = {
    input,
    output,
    structuredContent,
    helpers: createTemplateHelpers(),
  };

  // If template is already a string, check if it's MDX
  if (typeof template === 'string') {
    if (containsMdxSyntax(template)) {
      return renderMdxContent(template, ctx, mdxComponents);
    }
    return template;
  }

  // Check if it's a React component
  if (isReactComponent(template)) {
    try {
      // Dynamically import React and ReactDOMServer
      // This allows SDK to work without React as a hard dependency
      const [React, ReactDOMServer] = await Promise.all([
        import('react').catch(() => {
          throw new Error('React is required for React component templates. Install react as a dependency.');
        }),
        import('react-dom/server').catch(() => {
          throw new Error(
            'react-dom/server is required for React component templates. Install react-dom as a dependency.',
          );
        }),
      ]);

      // React components receive props, which is our context
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = React.createElement(template as React.ComponentType<any>, ctx);
      return ReactDOMServer.renderToString(element);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`React template rendering failed: ${message}`);
    }
  }

  // Execute as regular template builder function
  try {
    const result = (template as TemplateBuilderFn<unknown, unknown>)(ctx);

    // Check if the result is an MDX string (template function returned MDX)
    if (typeof result === 'string' && containsMdxSyntax(result)) {
      return renderMdxContent(result, ctx, mdxComponents);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Template rendering failed: ${message}`);
  }
}
