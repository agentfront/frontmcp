/**
 * Handlebars Renderer Module
 *
 * Provides Handlebars template rendering for HTML templates.
 * Enhances plain HTML with {{variable}} syntax support.
 *
 * @example
 * ```typescript
 * import { HandlebarsRenderer, createHandlebarsRenderer } from '@frontmcp/ui/handlebars';
 *
 * const renderer = createHandlebarsRenderer();
 *
 * const template = `
 *   <div class="card">
 *     <h2>{{escapeHtml output.title}}</h2>
 *     <p>Created: {{formatDate output.createdAt}}</p>
 *     {{#if output.items.length}}
 *       <ul>
 *         {{#each output.items}}
 *           <li>{{this.name}} - {{formatCurrency this.price}}</li>
 *         {{/each}}
 *       </ul>
 *     {{/if}}
 *   </div>
 * `;
 *
 * const html = renderer.render(template, {
 *   input: { query: 'test' },
 *   output: {
 *     title: 'Results',
 *     createdAt: new Date(),
 *     items: [{ name: 'Item 1', price: 9.99 }]
 *   }
 * });
 * ```
 *
 * @packageDocumentation
 */
import type { TemplateHelpers } from '../types';
import { type HelperFunction } from './helpers';
/**
 * Check if Handlebars is available.
 */
export declare function isHandlebarsAvailable(): Promise<boolean>;
/**
 * Options for the Handlebars renderer.
 */
export interface HandlebarsRendererOptions {
  /**
   * Additional custom helpers to register.
   */
  helpers?: Record<string, HelperFunction>;
  /**
   * Partial templates to register.
   */
  partials?: Record<string, string>;
  /**
   * Strict mode - error on missing variables.
   * @default false
   */
  strict?: boolean;
  /**
   * Whether to auto-escape output.
   * @default true
   */
  autoEscape?: boolean;
}
/**
 * Render context for templates.
 */
export interface RenderContext {
  /**
   * Tool input arguments.
   */
  input: Record<string, unknown>;
  /**
   * Tool output/result.
   */
  output: unknown;
  /**
   * Structured content (if schema provided).
   */
  structuredContent?: unknown;
  /**
   * Template helper functions.
   */
  helpers?: TemplateHelpers;
}
/**
 * Handlebars template renderer.
 *
 * Provides safe, cacheable Handlebars rendering with built-in helpers
 * for formatting, escaping, and logic.
 *
 * @example
 * ```typescript
 * const renderer = new HandlebarsRenderer();
 *
 * // Simple render
 * const html = await renderer.render('<div>{{output.name}}</div>', { output: { name: 'Test' } });
 *
 * // With custom helpers
 * renderer.registerHelper('shout', (str) => String(str).toUpperCase() + '!');
 * const html2 = await renderer.render('<div>{{shout output.name}}</div>', { output: { name: 'hello' } });
 * ```
 */
export declare class HandlebarsRenderer {
  private readonly options;
  private compiledTemplates;
  private initialized;
  private hbs;
  constructor(options?: HandlebarsRendererOptions);
  /**
   * Initialize the renderer with Handlebars.
   */
  private init;
  /**
   * Render a Handlebars template.
   *
   * @param template - Template string
   * @param context - Render context with input/output
   * @returns Rendered HTML string
   */
  render(template: string, context: RenderContext): Promise<string>;
  /**
   * Render a template synchronously.
   *
   * Note: Requires Handlebars to be pre-loaded. Use `render()` for async loading.
   *
   * @param template - Template string
   * @param context - Render context
   * @returns Rendered HTML string
   */
  renderSync(template: string, context: RenderContext): string;
  /**
   * Initialize synchronously (for environments where Handlebars is already loaded).
   */
  initSync(handlebars: typeof import('handlebars')): void;
  /**
   * Register a custom helper.
   *
   * @param name - Helper name
   * @param fn - Helper function
   */
  registerHelper(name: string, fn: HelperFunction): void;
  /**
   * Register a partial template.
   *
   * @param name - Partial name
   * @param template - Partial template string
   */
  registerPartial(name: string, template: string): void;
  /**
   * Clear compiled template cache.
   */
  clearCache(): void;
  /**
   * Check if a template string contains Handlebars syntax.
   *
   * @param template - Template string to check
   * @returns true if contains {{...}} syntax
   */
  static containsHandlebars(template: string): boolean;
  /**
   * Check if the renderer is initialized.
   */
  get isInitialized(): boolean;
}
/**
 * Create a new Handlebars renderer.
 *
 * @param options - Renderer options
 * @returns New HandlebarsRenderer instance
 */
export declare function createHandlebarsRenderer(options?: HandlebarsRendererOptions): HandlebarsRenderer;
/**
 * Render a template with default settings.
 *
 * Convenience function for one-off rendering.
 *
 * @param template - Template string
 * @param context - Render context
 * @returns Rendered HTML
 */
export declare function renderTemplate(template: string, context: RenderContext): Promise<string>;
/**
 * Check if a template contains Handlebars syntax.
 *
 * @param template - Template string
 * @returns true if contains {{...}}
 */
export declare function containsHandlebars(template: string): boolean;
export {
  builtinHelpers,
  escapeHtml,
  formatDate,
  formatCurrency,
  formatNumber,
  json,
  jsonEmbed,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  first,
  last,
  length,
  includes,
  join,
  uppercase,
  lowercase,
  capitalize,
  truncate,
  defaultValue,
  uniqueId,
  classNames,
  resetUniqueIdCounter,
  type HelperFunction,
} from './helpers';
export {
  extractExpressions,
  extractVariablePaths,
  extractOutputPaths,
  extractInputPaths,
  extractStructuredContentPaths,
  extractAll,
  hasVariablePaths,
  getExpressionAt,
  normalizePath,
  type ExtractedExpression,
  type ExtractionResult,
  type ExpressionType,
} from './expression-extractor';
//# sourceMappingURL=index.d.ts.map
