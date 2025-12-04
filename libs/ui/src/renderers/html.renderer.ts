/**
 * HTML Renderer
 *
 * Handles plain HTML templates:
 * - Static HTML strings
 * - Template builder functions: (ctx) => string
 *
 * This is the default fallback renderer with the lowest priority.
 */

import type { TemplateContext } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';
import type { UIRenderer, TranspileResult, TranspileOptions, RenderOptions, RuntimeScripts } from './types';
import { isTemplateBuilderFunction } from './utils/detect';
import { hashString } from './utils/hash';

/**
 * Template builder function type.
 */
type TemplateBuilderFn<In, Out> = (ctx: TemplateContext<In, Out>) => string;

/**
 * Types this renderer can handle.
 */
type HtmlTemplate<In = unknown, Out = unknown> = string | TemplateBuilderFn<In, Out>;

/**
 * HTML Renderer Implementation.
 *
 * Handles:
 * - Static HTML strings (passed through directly)
 * - Template builder functions that return HTML strings
 *
 * No transpilation is needed - this is a passthrough renderer.
 *
 * @example Static HTML
 * ```typescript
 * const template = '<div class="card">Hello World</div>';
 * await htmlRenderer.render(template, context);
 * ```
 *
 * @example Template function
 * ```typescript
 * const template = (ctx) => `<div>${ctx.helpers.escapeHtml(ctx.output.name)}</div>`;
 * await htmlRenderer.render(template, context);
 * ```
 */
export class HtmlRenderer implements UIRenderer<HtmlTemplate> {
  readonly type = 'html' as const;
  readonly priority = 0; // Lowest priority - fallback renderer

  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts:
   * - Any string (assumed to be HTML)
   * - Functions that are template builders (not React components)
   */
  canHandle(template: unknown): template is HtmlTemplate {
    // String templates
    if (typeof template === 'string') {
      return true;
    }

    // Template builder functions
    if (typeof template === 'function') {
      return isTemplateBuilderFunction(template as Function);
    }

    return false;
  }

  /**
   * Transpile the template.
   *
   * For HTML templates, no transpilation is needed.
   * This method returns a dummy result for consistency.
   */
  async transpile(template: HtmlTemplate, _options?: TranspileOptions): Promise<TranspileResult> {
    const source = typeof template === 'string' ? template : template.toString();
    const hash = hashString(source);

    return {
      code: '', // No transpiled code needed
      hash,
      cached: true, // Always "cached" since no work is done
    };
  }

  /**
   * Render the template to HTML string.
   *
   * For static strings, returns the string directly.
   * For functions, calls the function with the context.
   */
  async render<In, Out>(
    template: HtmlTemplate<In, Out>,
    context: TemplateContext<In, Out>,
    _options?: RenderOptions,
  ): Promise<string> {
    // Static HTML string
    if (typeof template === 'string') {
      return template;
    }

    // Template builder function
    if (typeof template === 'function') {
      return template(context);
    }

    // Fallback (should never reach here due to canHandle check)
    return String(template);
  }

  /**
   * Get runtime scripts for client-side functionality.
   *
   * HTML templates don't need additional runtime scripts.
   */
  getRuntimeScripts(_platform: PlatformCapabilities): RuntimeScripts {
    return {
      headScripts: '',
      isInline: false,
    };
  }
}

/**
 * Singleton instance of the HTML renderer.
 */
export const htmlRenderer = new HtmlRenderer();
