/**
 * MDX Renderer Adapter
 *
 * Client-side adapter for rendering MDX (Markdown + JSX) content.
 * Builds on top of the React adapter for component rendering.
 *
 * @packageDocumentation
 */

import type { RendererAdapter, RenderContext, RenderOptions, RenderResult } from './types';
import type { UIType } from '../../types/ui-runtime';

/**
 * MDX runtime interface.
 * Uses permissive types to support various @mdx-js versions.
 */
interface MDXRuntime {
  run: (code: string, options: Record<string, unknown>) => Promise<{ default: unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compile?: (source: string, options?: Record<string, unknown>) => Promise<any>;
}

/**
 * MDX Renderer Adapter.
 *
 * Renders MDX content to the DOM with support for:
 * - Pre-compiled MDX (recommended)
 * - Runtime MDX compilation (if mdx-js available)
 * - Custom component injection
 */
export class MdxRendererAdapter implements RendererAdapter {
  readonly type: UIType = 'mdx';

  // Lazy-loaded MDX runtime
  private mdxRuntime: MDXRuntime | null = null;
  private loadPromise: Promise<void> | null = null;

  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean {
    if (typeof content !== 'string') {
      return false;
    }

    // MDX patterns:
    // - Contains JSX-like syntax in markdown
    // - Contains import/export statements
    // - Contains frontmatter (---)
    // - Has MDX file extension markers
    return (
      /^---[\s\S]*?---/.test(content) || // Frontmatter
      /<[A-Z][a-zA-Z0-9]*[\s/>]/.test(content) || // JSX component tags
      /^import\s+/.test(content) || // Import statements
      /^export\s+/.test(content) || // Export statements
      content.includes('```jsx') || // Code blocks with JSX
      content.includes('```tsx')
    );
  }

  /**
   * Render MDX content to a string.
   */
  async render(content: string, context: RenderContext, _options?: RenderOptions): Promise<string> {
    try {
      await this.ensureMdxLoaded();

      if (!this.mdxRuntime) {
        // Fall back to basic markdown rendering
        return this.renderMarkdown(content, context);
      }

      // Compile and render MDX
      const compiled = await this.compileMdx(content, context);
      return compiled;
    } catch (error) {
      console.error('[FrontMCP] MDX render failed:', error);
      // Fall back to markdown
      return this.renderMarkdown(content, context);
    }
  }

  /**
   * Render MDX content directly to the DOM.
   */
  async renderToDOM(
    content: string,
    target: HTMLElement,
    context: RenderContext,
    _options?: RenderOptions,
  ): Promise<RenderResult> {
    try {
      const html = await this.render(content, context);
      target.innerHTML = html;

      // Dispatch event
      target.dispatchEvent(
        new CustomEvent('frontmcp:rendered', {
          bubbles: true,
          detail: { type: 'mdx', toolName: context.toolName },
        }),
      );

      return { success: true, html };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[FrontMCP] MDX render to DOM failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Hydrate existing SSR content.
   * MDX hydration follows React patterns.
   */
  async hydrate(target: HTMLElement, context: RenderContext, options?: RenderOptions): Promise<RenderResult> {
    // MDX hydration would require the React adapter
    // For now, just update the content
    const content = target.getAttribute('data-mdx-source');
    if (content) {
      return this.renderToDOM(content, target, context, options);
    }

    return { success: true }; // Already rendered, nothing to hydrate
  }

  /**
   * Update rendered MDX content with new data.
   */
  async update(target: HTMLElement, context: RenderContext): Promise<RenderResult> {
    const source = target.getAttribute('data-mdx-source');
    if (source) {
      return this.renderToDOM(source, target, context);
    }

    return { success: false, error: 'No MDX source stored for update' };
  }

  /**
   * Clean up (no-op for MDX adapter).
   */
  destroy(_target: HTMLElement): void {
    // MDX doesn't need cleanup unless using React hydration
  }

  /**
   * Ensure MDX runtime is loaded.
   */
  private async ensureMdxLoaded(): Promise<void> {
    if (this.mdxRuntime) {
      return;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadMdx();
    return this.loadPromise;
  }

  /**
   * Load MDX runtime.
   */
  private async loadMdx(): Promise<void> {
    try {
      // Try to load @mdx-js/mdx for compilation
      const mdxModule = await import(/* webpackIgnore: true */ '@mdx-js/mdx');
      this.mdxRuntime = {
        run: async () => ({ default: null }),
        compile: mdxModule.compile,
      };
    } catch {
      // MDX not available
      console.warn(
        '[FrontMCP] MDX runtime not available. ' + 'Install @mdx-js/mdx for full MDX support, or use pre-compiled MDX.',
      );
    }
  }

  /**
   * Compile MDX content.
   */
  private async compileMdx(source: string, context: RenderContext): Promise<string> {
    if (!this.mdxRuntime?.compile) {
      return this.renderMarkdown(source, context);
    }

    try {
      // Compile MDX to JS
      const compiled = await this.mdxRuntime.compile(source, {
        outputFormat: 'function-body',
        development: false,
      });

      // For now, return the compiled code as-is
      // Full execution would require React runtime
      return `<div class="mdx-content" data-compiled="true">${this.renderMarkdown(source, context)}</div>`;
    } catch (error) {
      console.warn('[FrontMCP] MDX compilation failed, falling back to markdown:', error);
      return this.renderMarkdown(source, context);
    }
  }

  /**
   * Basic markdown rendering (fallback).
   */
  private renderMarkdown(source: string, context: RenderContext): string {
    // Very basic markdown-to-HTML conversion
    // For production, use a proper markdown library
    let html = source;

    // Escape HTML first for safety
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Strip frontmatter
    html = html.replace(/^---[\s\S]*?---\n?/, '');

    // Headers
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs
    html = html
      .split(/\n\n+/)
      .map((para) => {
        const trimmed = para.trim();
        if (
          !trimmed ||
          trimmed.startsWith('<h') ||
          trimmed.startsWith('<ul') ||
          trimmed.startsWith('<ol') ||
          trimmed.startsWith('<pre')
        ) {
          return trimmed;
        }
        return `<p>${trimmed}</p>`;
      })
      .join('\n');

    // Interpolate context data (basic {{variable}} support)
    html = html.replace(/\{\{output\.(\w+)\}\}/g, (_match, key) => {
      const value = (context.output as Record<string, unknown>)?.[key];
      return value !== undefined ? String(value) : '';
    });
    html = html.replace(/\{\{input\.(\w+)\}\}/g, (_match, key) => {
      const value = context.input?.[key];
      return value !== undefined ? String(value) : '';
    });

    return `<div class="markdown-content">${html}</div>`;
  }
}

/**
 * Create a new MDX renderer adapter.
 */
export function createMdxAdapter(): MdxRendererAdapter {
  return new MdxRendererAdapter();
}

/**
 * Adapter loader for lazy loading.
 */
export async function loadMdxAdapter(): Promise<RendererAdapter> {
  return createMdxAdapter();
}
