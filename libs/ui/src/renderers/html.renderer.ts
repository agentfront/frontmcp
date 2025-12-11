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
 * Lazy-loaded HandlebarsRenderer for Handlebars template support.
 */
let handlebarsRenderer: {
  render: (
    template: string,
    context: { input: unknown; output: unknown; structuredContent?: unknown },
  ) => Promise<string>;
  containsHandlebars: (template: string) => boolean;
} | null = null;

/**
 * Load HandlebarsRenderer if available.
 */
async function loadHandlebarsRenderer(): Promise<typeof handlebarsRenderer> {
  if (handlebarsRenderer !== null) {
    return handlebarsRenderer;
  }

  try {
    // Dynamic import with explicit .js extension for ESM compatibility
    const handlebarsModule = await import(/* webpackIgnore: true */ '../handlebars/index.js');
    const { HandlebarsRenderer } = handlebarsModule;
    const renderer = new HandlebarsRenderer();
    handlebarsRenderer = {
      render: (template: string, context: { input: unknown; output: unknown; structuredContent?: unknown }) =>
        renderer.render(template, {
          input: (context.input ?? {}) as Record<string, unknown>,
          output: context.output,
          structuredContent: context.structuredContent,
        }),
      containsHandlebars: (template: string) => HandlebarsRenderer.containsHandlebars(template),
    };
    return handlebarsRenderer;
  } catch {
    // Handlebars not available, return null
    return null;
  }
}

/**
 * Check if a template contains Handlebars syntax.
 * Non-async version for canHandle check.
 */
function containsHandlebars(template: string): boolean {
  // Match {{...}} but not {{! comments }}
  return /\{\{(?!!)[\s\S]*?\}\}/.test(template);
}

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
export class HtmlRenderer implements UIRenderer<HtmlTemplate> {
  readonly type = 'html' as const;
  readonly priority = 0; // Lowest priority - fallback renderer

  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts:
   * - Any string (assumed to be HTML, with or without Handlebars)
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
   * Check if a template uses Handlebars syntax.
   *
   * @param template - Template string to check
   * @returns true if template contains {{...}} syntax
   */
  usesHandlebars(template: string): boolean {
    return containsHandlebars(template);
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
   * For static strings without Handlebars, returns the string directly.
   * For strings with Handlebars syntax, processes with HandlebarsRenderer.
   * For functions, calls the function with the context.
   */
  async render<In, Out>(
    template: HtmlTemplate<In, Out>,
    context: TemplateContext<In, Out>,
    _options?: RenderOptions,
  ): Promise<string> {
    // Static HTML string
    if (typeof template === 'string') {
      // Check for Handlebars syntax
      if (containsHandlebars(template)) {
        return this.renderHandlebars(template, context);
      }
      return template;
    }

    // Template builder function
    if (typeof template === 'function') {
      const result = template(context);
      // Check if the function result contains Handlebars
      if (typeof result === 'string' && containsHandlebars(result)) {
        return this.renderHandlebars(result, context);
      }
      return result;
    }

    // Fallback (should never reach here due to canHandle check)
    return String(template);
  }

  /**
   * Render Handlebars template with context.
   */
  private async renderHandlebars<In, Out>(template: string, context: TemplateContext<In, Out>): Promise<string> {
    const renderer = await loadHandlebarsRenderer();

    if (!renderer) {
      // Handlebars not available, return template as-is with a warning comment
      console.warn(
        '[@frontmcp/ui] Template contains Handlebars syntax but handlebars is not installed. ' +
          'Install it for template interpolation: npm install handlebars',
      );
      return template;
    }

    return renderer.render(template, {
      input: context.input as Record<string, unknown>,
      output: context.output,
      structuredContent: context.structuredContent,
    });
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

/**
 * Check if a template string contains Handlebars syntax.
 *
 * @param template - Template string
 * @returns true if contains {{...}}
 */
export { containsHandlebars };
