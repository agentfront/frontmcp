/**
 * HTML Renderer Adapter
 *
 * Client-side adapter for rendering HTML templates.
 * Handles plain HTML and Handlebars-enhanced templates.
 *
 * @packageDocumentation
 */

import type { RendererAdapter, RenderContext, RenderOptions, RenderResult } from './types';
import type { UIType } from '../../types/ui-runtime';

/**
 * HTML Renderer Adapter.
 *
 * Renders HTML templates to the DOM with support for:
 * - Plain HTML strings
 * - Handlebars-enhanced templates ({{...}} syntax)
 * - Template builder functions
 */
export class HtmlRendererAdapter implements RendererAdapter {
  readonly type: UIType = 'html';

  // Lazy-loaded Handlebars renderer
  private handlebarsRenderer: {
    render: (template: string, context: { input: Record<string, unknown>; output: unknown }) => Promise<string>;
    containsHandlebars: (template: string) => boolean;
  } | null = null;

  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean {
    // HTML adapter can handle any string
    return typeof content === 'string';
  }

  /**
   * Render HTML content to a string.
   */
  async render(content: string, context: RenderContext, _options?: RenderOptions): Promise<string> {
    // Check for Handlebars syntax
    if (this.containsHandlebars(content)) {
      return this.renderHandlebars(content, context);
    }

    // Plain HTML - return as-is
    return content;
  }

  /**
   * Render HTML content directly to the DOM.
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

      // Dispatch event to notify that content has been rendered
      target.dispatchEvent(
        new CustomEvent('frontmcp:rendered', {
          bubbles: true,
          detail: { type: 'html', toolName: context.toolName },
        }),
      );

      return { success: true, html };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[FrontMCP] HTML render failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Update rendered content with new data.
   */
  async update(target: HTMLElement, context: RenderContext): Promise<RenderResult> {
    // Get the original template from data attribute
    const template = target.getAttribute('data-template');

    if (template) {
      return this.renderToDOM(template, target, context);
    }

    // No template stored - can't update
    return { success: false, error: 'No template stored for update' };
  }

  /**
   * Clean up (no-op for HTML adapter).
   */
  destroy(_target: HTMLElement): void {
    // HTML doesn't need cleanup
  }

  /**
   * Check if content contains Handlebars syntax.
   */
  private containsHandlebars(template: string): boolean {
    // Match {{...}} but not {{! comments }}
    return /\{\{(?!!)[^}]*\}\}/.test(template);
  }

  /**
   * Render Handlebars template.
   */
  private async renderHandlebars(template: string, context: RenderContext): Promise<string> {
    // Lazy-load Handlebars renderer
    if (!this.handlebarsRenderer) {
      try {
        // Try to load from parent module
        const handlebarsModule = await import('../../handlebars/index.js');
        const { HandlebarsRenderer } = handlebarsModule;
        const renderer = new HandlebarsRenderer();
        this.handlebarsRenderer = {
          render: (tmpl: string, ctx: { input: Record<string, unknown>; output: unknown }) =>
            renderer.render(tmpl, ctx),
          containsHandlebars: (tmpl: string) => HandlebarsRenderer.containsHandlebars(tmpl),
        };
      } catch {
        // Handlebars not available - return template as-is with warning
        console.warn(
          '[FrontMCP] Template contains Handlebars syntax but handlebars module not available. ' +
            'Ensure @frontmcp/ui/handlebars is properly bundled.',
        );
        return template;
      }
    }

    return this.handlebarsRenderer.render(template, {
      input: context.input,
      output: context.output,
    });
  }
}

/**
 * Create a new HTML renderer adapter.
 */
export function createHtmlAdapter(): HtmlRendererAdapter {
  return new HtmlRendererAdapter();
}

/**
 * Adapter loader for lazy loading.
 */
export async function loadHtmlAdapter(): Promise<RendererAdapter> {
  return createHtmlAdapter();
}
