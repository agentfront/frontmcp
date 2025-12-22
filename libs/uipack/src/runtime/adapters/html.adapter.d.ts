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
export declare class HtmlRendererAdapter implements RendererAdapter {
  readonly type: UIType;
  private handlebarsRenderer;
  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean;
  /**
   * Render HTML content to a string.
   */
  render(content: string, context: RenderContext, _options?: RenderOptions): Promise<string>;
  /**
   * Render HTML content directly to the DOM.
   */
  renderToDOM(
    content: string,
    target: HTMLElement,
    context: RenderContext,
    _options?: RenderOptions,
  ): Promise<RenderResult>;
  /**
   * Update rendered content with new data.
   */
  update(target: HTMLElement, context: RenderContext): Promise<RenderResult>;
  /**
   * Clean up (no-op for HTML adapter).
   */
  destroy(_target: HTMLElement): void;
  /**
   * Check if content contains Handlebars syntax.
   */
  private containsHandlebars;
  /**
   * Render Handlebars template.
   */
  private renderHandlebars;
}
/**
 * Create a new HTML renderer adapter.
 */
export declare function createHtmlAdapter(): HtmlRendererAdapter;
/**
 * Adapter loader for lazy loading.
 */
export declare function loadHtmlAdapter(): Promise<RendererAdapter>;
//# sourceMappingURL=html.adapter.d.ts.map
