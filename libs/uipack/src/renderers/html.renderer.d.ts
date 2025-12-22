/**
 * HTML Renderer
 *
 * Handles plain HTML templates:
 * - Static HTML strings
 * - Template builder functions: (ctx) => string
 * - Handlebars-enhanced templates: HTML with {{variable}} syntax
 *
 * This is the default fallback renderer with the lowest priority.
 */
import type { TemplateContext } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';
import type { UIRenderer, TranspileResult, TranspileOptions, RenderOptions, RuntimeScripts } from './types';
/**
 * Template builder function type.
 */
type TemplateBuilderFn<In, Out> = (ctx: TemplateContext<In, Out>) => string;
/**
 * Types this renderer can handle.
 */
type HtmlTemplate<In = unknown, Out = unknown> = string | TemplateBuilderFn<In, Out>;
/**
 * Check if a template contains Handlebars syntax.
 * Non-async version for canHandle check.
 */
declare function containsHandlebars(template: string): boolean;
/**
 * HTML Renderer Implementation.
 *
 * Handles:
 * - Static HTML strings (passed through directly)
 * - Template builder functions that return HTML strings
 * - Handlebars-enhanced templates (detected by {{...}} syntax)
 *
 * When Handlebars syntax is detected, the template is processed
 * with the HandlebarsRenderer for variable interpolation, conditionals,
 * and loops.
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
 *
 * @example Handlebars template
 * ```typescript
 * const template = `
 *   <div class="card">
 *     <h2>{{escapeHtml output.title}}</h2>
 *     {{#if output.items}}
 *       <ul>
 *         {{#each output.items}}
 *           <li>{{this.name}}</li>
 *         {{/each}}
 *       </ul>
 *     {{/if}}
 *   </div>
 * `;
 * await htmlRenderer.render(template, context);
 * ```
 */
export declare class HtmlRenderer implements UIRenderer<HtmlTemplate> {
  readonly type: 'html';
  readonly priority = 0;
  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts:
   * - Any string (assumed to be HTML, with or without Handlebars)
   * - Functions that are template builders (not React components)
   */
  canHandle(template: unknown): template is HtmlTemplate;
  /**
   * Check if a template uses Handlebars syntax.
   *
   * @param template - Template string to check
   * @returns true if template contains {{...}} syntax
   */
  usesHandlebars(template: string): boolean;
  /**
   * Transpile the template.
   *
   * For HTML templates, no transpilation is needed.
   * This method returns a dummy result for consistency.
   */
  transpile(template: HtmlTemplate, _options?: TranspileOptions): Promise<TranspileResult>;
  /**
   * Render the template to HTML string.
   *
   * For static strings without Handlebars, returns the string directly.
   * For strings with Handlebars syntax, processes with HandlebarsRenderer.
   * For functions, calls the function with the context.
   */
  render<In, Out>(
    template: HtmlTemplate<In, Out>,
    context: TemplateContext<In, Out>,
    _options?: RenderOptions,
  ): Promise<string>;
  /**
   * Render Handlebars template with context.
   */
  private renderHandlebars;
  /**
   * Get runtime scripts for client-side functionality.
   *
   * HTML templates don't need additional runtime scripts.
   */
  getRuntimeScripts(_platform: PlatformCapabilities): RuntimeScripts;
}
/**
 * Singleton instance of the HTML renderer.
 */
export declare const htmlRenderer: HtmlRenderer;
/**
 * Check if a template string contains Handlebars syntax.
 *
 * @param template - Template string
 * @returns true if contains {{...}}
 */
export { containsHandlebars };
//# sourceMappingURL=html.renderer.d.ts.map
