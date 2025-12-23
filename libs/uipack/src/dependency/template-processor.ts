/**
 * Template Processor
 *
 * Processes resolved templates through format-specific rendering pipelines:
 * - HTML: Handlebars → Output
 * - Markdown: Handlebars → marked → HTML
 * - MDX: Handlebars → MDX Renderer → HTML
 * - React: Pass-through (data via props, needs bundling)
 *
 * @packageDocumentation
 */

import type {
  ResolvedTemplate,
  TemplateProcessingOptions,
  ProcessedTemplate,
  TemplateFormat,
  TemplateSource,
} from './types';
import { HandlebarsRenderer, containsHandlebars, type RenderContext, type HelperFunction } from '../handlebars';
import { mdxClientRenderer } from '../renderers/mdx-client.renderer';
import type { TemplateContext } from '../runtime/types';
import { validateTemplate, logValidationWarnings } from '../validation';
import { escapeHtml } from '../utils';

// ============================================
// Helper Functions
// ============================================

/**
 * Safely convert context.input to a Record, handling non-object values.
 */
function safeInputToRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

/**
 * Default template helpers.
 * Reused across different template processors to avoid duplication.
 */
const defaultHelpers = {
  escapeHtml,
  formatDate: (date: Date | string, format?: string) => {
    const d = date instanceof Date ? date : new Date(date);
    if (format === 'iso') return d.toISOString();
    if (format === 'time') return d.toLocaleTimeString();
    return d.toLocaleDateString();
  },
  formatCurrency: (amount: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount),
  uniqueId: (prefix = 'id') => `${prefix}-${Math.random().toString(36).substring(2, 9)}`,
  jsonEmbed: (data: unknown) =>
    JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'),
};

/**
 * Get a human-readable name from a template source.
 */
function getSourceName(source: TemplateSource): string {
  switch (source.type) {
    case 'file':
      return source.path;
    case 'url':
      return source.url;
    case 'inline':
      return 'inline-template';
  }
}

// ============================================
// Singleton Handlebars Renderer
// ============================================

/**
 * Shared Handlebars renderer instance.
 * Caches compiled templates across calls.
 */
let handlebarsRenderer: HandlebarsRenderer | null = null;

/**
 * Get or create a Handlebars renderer.
 *
 * When customHelpers are provided, returns a fresh instance to avoid
 * cross-contamination of helpers between different templates.
 * When no custom helpers, returns the shared singleton for performance.
 */
async function getHandlebarsRenderer(
  customHelpers?: Record<string, (...args: unknown[]) => unknown>,
): Promise<HandlebarsRenderer> {
  // If custom helpers provided, create a fresh instance to avoid cross-contamination
  if (customHelpers) {
    const freshRenderer = new HandlebarsRenderer();
    for (const [name, fn] of Object.entries(customHelpers)) {
      freshRenderer.registerHelper(name, fn as HelperFunction);
    }
    return freshRenderer;
  }

  // Use shared singleton when no custom helpers
  if (!handlebarsRenderer) {
    handlebarsRenderer = new HandlebarsRenderer();
  }

  return handlebarsRenderer;
}

/**
 * Clear the Handlebars renderer cache.
 * Useful for testing.
 */
export function clearHandlebarsCache(): void {
  if (handlebarsRenderer) {
    handlebarsRenderer.clearCache();
  }
}

// ============================================
// Marked (Markdown Parser)
// ============================================

/**
 * Minimal type interface for marked module.
 * This allows the code to compile without requiring marked to be installed.
 * The actual module is lazy-loaded at runtime.
 */
interface MarkedModule {
  marked: {
    parse: (markdown: string) => Promise<string> | string;
  };
}

/**
 * Lazy-loaded marked module.
 */
let markedModule: MarkedModule | null = null;

/**
 * Load the marked module for Markdown parsing.
 */
async function loadMarked(): Promise<MarkedModule> {
  if (markedModule) {
    return markedModule;
  }

  try {
    // Use a variable to prevent TypeScript from checking the module at compile time
    const moduleName = 'marked';
    markedModule = (await import(/* webpackIgnore: true */ moduleName)) as unknown as MarkedModule;
    return markedModule;
  } catch {
    throw new Error('marked is required for Markdown rendering. Install it: npm install marked');
  }
}

/**
 * Check if marked is available.
 */
export async function isMarkedAvailable(): Promise<boolean> {
  try {
    await loadMarked();
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Template Processing
// ============================================

/**
 * Process a resolved template through the appropriate rendering pipeline.
 *
 * Processing differs by format:
 * - **HTML**: Apply Handlebars if {{...}} present → Return HTML
 * - **Markdown**: Apply Handlebars → Parse with marked → Return HTML
 * - **MDX**: Apply Handlebars → Render with MDX renderer → Return HTML
 * - **React**: Return as-is (data passed via props, needs bundling)
 *
 * @param resolved - Resolved template from template-loader
 * @param options - Processing options with context data
 * @returns Processed template ready for rendering
 *
 * @example HTML template
 * ```typescript
 * const resolved = await resolveTemplate('./weather.html');
 * const result = await processTemplate(resolved, {
 *   context: {
 *     input: { city: 'Seattle' },
 *     output: { temperature: 72, conditions: 'Sunny' },
 *   },
 * });
 * // result.html = '<div>72°F in Seattle</div>'
 * ```
 *
 * @example Markdown template
 * ```typescript
 * const resolved = await resolveTemplate('./report.md');
 * const result = await processTemplate(resolved, {
 *   context: {
 *     input: {},
 *     output: { title: 'Q4 Report', items: [...] },
 *   },
 * });
 * // result.html = '<h1>Q4 Report</h1>...'
 * ```
 */
export async function processTemplate(
  resolved: ResolvedTemplate,
  options: TemplateProcessingOptions,
): Promise<ProcessedTemplate> {
  const { format, content } = resolved;
  const { context, handlebarsHelpers, outputSchema, inputSchema, toolName } = options;

  // React templates don't use Handlebars - data is passed via props
  if (format === 'react') {
    return {
      code: content,
      format: 'react',
      needsBundling: true,
    };
  }

  // ============================================
  // Template Validation (Development Mode Only)
  // ============================================

  // Validate Handlebars expressions against output schema when provided
  if (outputSchema && process.env['NODE_ENV'] !== 'production' && containsHandlebars(content)) {
    // Extract source name for error messages
    const sourceName = getSourceName(resolved.source);

    const validation = validateTemplate(content, outputSchema, {
      inputSchema,
      warnOnOptional: true,
      suggestSimilar: true,
      toolName: toolName ?? sourceName,
    });

    if (!validation.valid || validation.warnings.length > 0) {
      logValidationWarnings(validation, toolName ?? sourceName ?? 'unknown');
    }
  }

  // Step 1: Apply Handlebars for HTML, Markdown, MDX
  let processedContent = content;

  if (containsHandlebars(content)) {
    const hbs = await getHandlebarsRenderer(handlebarsHelpers);

    const renderContext: RenderContext = {
      input: safeInputToRecord(context.input),
      output: context.output,
      structuredContent: context.structuredContent,
    };

    processedContent = await hbs.render(content, renderContext);
  }

  // Step 2: Format-specific rendering
  switch (format) {
    case 'html':
      return {
        html: processedContent,
        format: 'html',
      };

    case 'markdown': {
      const { marked } = await loadMarked();
      const html = await marked.parse(processedContent);
      return {
        html,
        format: 'markdown',
      };
    }

    case 'mdx': {
      // MDX renderer expects a TemplateContext
      const templateContext: TemplateContext<unknown, unknown> = {
        input: context.input,
        output: context.output,
        structuredContent: context.structuredContent,
        helpers: defaultHelpers,
      };

      const html = await mdxClientRenderer.render(processedContent, templateContext);
      return {
        html,
        format: 'mdx',
      };
    }

    default:
      // Fallback to HTML
      return {
        html: processedContent,
        format: 'html',
      };
  }
}

/**
 * Process multiple templates in parallel.
 *
 * @param items - Array of resolved templates with their options
 * @returns Array of processed templates
 */
export async function processTemplates(
  items: Array<{ resolved: ResolvedTemplate; options: TemplateProcessingOptions }>,
): Promise<ProcessedTemplate[]> {
  return Promise.all(items.map(({ resolved, options }) => processTemplate(resolved, options)));
}

/**
 * Check if a template format requires Handlebars processing.
 *
 * @param format - Template format
 * @returns true if Handlebars can be applied
 */
export function supportsHandlebars(format: TemplateFormat): boolean {
  return format === 'html' || format === 'markdown' || format === 'mdx';
}

/**
 * Check if a template format produces HTML output.
 *
 * @param format - Template format
 * @returns true if the format produces HTML
 */
export function producesHtml(format: TemplateFormat): boolean {
  return format !== 'react';
}

/**
 * Check if a template format requires bundling.
 *
 * @param format - Template format
 * @returns true if the format needs to be bundled
 */
export function requiresBundling(format: TemplateFormat): boolean {
  return format === 'react';
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Process an HTML template with Handlebars.
 *
 * @param content - HTML template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export async function processHtmlTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string> {
  if (!containsHandlebars(content)) {
    return content;
  }

  const hbs = await getHandlebarsRenderer(helpers);

  const renderContext: RenderContext = {
    input: safeInputToRecord(context.input),
    output: context.output,
    structuredContent: context.structuredContent,
  };

  return hbs.render(content, renderContext);
}

/**
 * Process a Markdown template with Handlebars and marked.
 *
 * @param content - Markdown template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export async function processMarkdownTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string> {
  // Apply Handlebars first
  let processed = content;
  if (containsHandlebars(content)) {
    const hbs = await getHandlebarsRenderer(helpers);

    const renderContext: RenderContext = {
      input: safeInputToRecord(context.input),
      output: context.output,
      structuredContent: context.structuredContent,
    };

    processed = await hbs.render(content, renderContext);
  }

  // Then parse Markdown
  const { marked } = await loadMarked();
  return marked.parse(processed);
}

/**
 * Process an MDX template with Handlebars and MDX renderer.
 *
 * @param content - MDX template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export async function processMdxTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string> {
  // Apply Handlebars first
  let processed = content;
  if (containsHandlebars(content)) {
    const hbs = await getHandlebarsRenderer(helpers);

    const renderContext: RenderContext = {
      input: safeInputToRecord(context.input),
      output: context.output,
      structuredContent: context.structuredContent,
    };

    processed = await hbs.render(content, renderContext);
  }

  // Then render MDX
  const templateContext: TemplateContext<unknown, unknown> = {
    input: context.input,
    output: context.output,
    structuredContent: context.structuredContent,
    helpers: defaultHelpers,
  };

  return mdxClientRenderer.render(processed, templateContext);
}
