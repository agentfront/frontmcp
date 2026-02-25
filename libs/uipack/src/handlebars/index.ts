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
import { builtinHelpers, type HelperFunction } from './helpers';

/**
 * Lazy-loaded Handlebars module.
 */
let Handlebars: typeof import('handlebars') | null = null;

/**
 * Load Handlebars module.
 */
async function loadHandlebars(): Promise<typeof import('handlebars')> {
  if (Handlebars !== null) {
    return Handlebars;
  }

  try {
    Handlebars = await import('handlebars');
    return Handlebars;
  } catch {
    throw new Error('Handlebars is required for template rendering. Install it: npm install handlebars');
  }
}

/**
 * Check if Handlebars is available.
 */
export async function isHandlebarsAvailable(): Promise<boolean> {
  try {
    await loadHandlebars();
    return true;
  } catch {
    return false;
  }
}

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
export class HandlebarsRenderer {
  private readonly options: HandlebarsRendererOptions;
  private compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();
  private initialized = false;
  private hbs: typeof import('handlebars') | null = null;

  constructor(options: HandlebarsRendererOptions = {}) {
    this.options = {
      strict: false,
      autoEscape: true,
      ...options,
    };
  }

  /**
   * Initialize the renderer with Handlebars.
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    this.hbs = await loadHandlebars();

    // Register built-in helpers
    for (const [name, helper] of Object.entries(builtinHelpers)) {
      this.hbs.registerHelper(name, helper as Handlebars.HelperDelegate);
    }

    // Register custom helpers
    if (this.options.helpers) {
      for (const [name, helper] of Object.entries(this.options.helpers)) {
        this.hbs.registerHelper(name, helper as Handlebars.HelperDelegate);
      }
    }

    // Register partials
    if (this.options.partials) {
      for (const [name, template] of Object.entries(this.options.partials)) {
        this.hbs.registerPartial(name, template);
      }
    }

    this.initialized = true;
  }

  /**
   * Render a Handlebars template.
   *
   * @param template - Template string
   * @param context - Render context with input/output
   * @returns Rendered HTML string
   */
  async render(template: string, context: RenderContext): Promise<string> {
    await this.init();

    if (!this.hbs) {
      throw new Error('Handlebars not initialized');
    }

    // Get or compile template
    let compiled = this.compiledTemplates.get(template);
    if (!compiled) {
      compiled = this.hbs.compile(template, {
        strict: this.options.strict,
        noEscape: !this.options.autoEscape,
      });
      this.compiledTemplates.set(template, compiled);
    }

    // Build template data
    const data = {
      input: context.input ?? {},
      output: context.output ?? {},
      structuredContent: context.structuredContent,
      // Also expose at root level for convenience
      ...context.input,
      ...(typeof context.output === 'object' && context.output !== null
        ? (context.output as Record<string, unknown>)
        : {}),
    };

    // Render template
    try {
      return compiled(data);
    } catch (error) {
      throw new Error(`Template rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render a template synchronously.
   *
   * Note: Requires Handlebars to be pre-loaded. Use `render()` for async loading.
   *
   * @param template - Template string
   * @param context - Render context
   * @returns Rendered HTML string
   */
  renderSync(template: string, context: RenderContext): string {
    if (!this.initialized || !this.hbs) {
      throw new Error('HandlebarsRenderer not initialized. Call render() first or use initSync().');
    }

    // Get or compile template
    let compiled = this.compiledTemplates.get(template);
    if (!compiled) {
      compiled = this.hbs.compile(template, {
        strict: this.options.strict,
        noEscape: !this.options.autoEscape,
      });
      this.compiledTemplates.set(template, compiled);
    }

    // Build template data
    const data = {
      input: context.input ?? {},
      output: context.output ?? {},
      structuredContent: context.structuredContent,
      ...context.input,
      ...(typeof context.output === 'object' && context.output !== null
        ? (context.output as Record<string, unknown>)
        : {}),
    };

    return compiled(data);
  }

  /**
   * Initialize synchronously (for environments where Handlebars is already loaded).
   */
  initSync(handlebars: typeof import('handlebars')): void {
    this.hbs = handlebars;

    // Register built-in helpers
    for (const [name, helper] of Object.entries(builtinHelpers)) {
      this.hbs.registerHelper(name, helper as Handlebars.HelperDelegate);
    }

    // Register custom helpers
    if (this.options.helpers) {
      for (const [name, helper] of Object.entries(this.options.helpers)) {
        this.hbs.registerHelper(name, helper as Handlebars.HelperDelegate);
      }
    }

    // Register partials
    if (this.options.partials) {
      for (const [name, template] of Object.entries(this.options.partials)) {
        this.hbs.registerPartial(name, template);
      }
    }

    this.initialized = true;
  }

  /**
   * Register a custom helper.
   *
   * @param name - Helper name
   * @param fn - Helper function
   */
  registerHelper(name: string, fn: HelperFunction): void {
    if (this.hbs) {
      this.hbs.registerHelper(name, fn as Handlebars.HelperDelegate);
    }
    // Also store for future use
    if (!this.options.helpers) {
      this.options.helpers = {};
    }
    this.options.helpers[name] = fn;
  }

  /**
   * Register a partial template.
   *
   * @param name - Partial name
   * @param template - Partial template string
   */
  registerPartial(name: string, template: string): void {
    if (this.hbs) {
      this.hbs.registerPartial(name, template);
    }
    // Also store for future use
    if (!this.options.partials) {
      this.options.partials = {};
    }
    this.options.partials[name] = template;
  }

  /**
   * Clear compiled template cache.
   */
  clearCache(): void {
    this.compiledTemplates.clear();
  }

  /**
   * Check if a template string contains Handlebars syntax.
   *
   * @param template - Template string to check
   * @returns true if contains {{...}} syntax
   */
  static containsHandlebars(template: string): boolean {
    // Match {{...}} but not {{! comments }}
    return /\{\{(?!!)[\s\S]*?\}\}/.test(template);
  }

  /**
   * Check if the renderer is initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a new Handlebars renderer.
 *
 * @param options - Renderer options
 * @returns New HandlebarsRenderer instance
 */
export function createHandlebarsRenderer(options?: HandlebarsRendererOptions): HandlebarsRenderer {
  return new HandlebarsRenderer(options);
}

/**
 * Render a template with default settings.
 *
 * Convenience function for one-off rendering.
 *
 * @param template - Template string
 * @param context - Render context
 * @returns Rendered HTML
 */
export async function renderTemplate(template: string, context: RenderContext): Promise<string> {
  const renderer = createHandlebarsRenderer();
  return renderer.render(template, context);
}

/**
 * Check if a template contains Handlebars syntax.
 *
 * @param template - Template string
 * @returns true if contains {{...}}
 */
export function containsHandlebars(template: string): boolean {
  return HandlebarsRenderer.containsHandlebars(template);
}

// ============================================
// Re-exports
// ============================================

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

// ============================================
// Expression Extraction
// ============================================

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

// Handlebars types
type HandlebarsTemplateDelegate = ReturnType<(typeof import('handlebars'))['compile']>;
