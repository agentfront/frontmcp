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
import type { ResolvedTemplate, TemplateProcessingOptions, ProcessedTemplate, TemplateFormat } from './types';
/**
 * Clear the Handlebars renderer cache.
 * Useful for testing.
 */
export declare function clearHandlebarsCache(): void;
/**
 * Check if marked is available.
 */
export declare function isMarkedAvailable(): Promise<boolean>;
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
export declare function processTemplate(
  resolved: ResolvedTemplate,
  options: TemplateProcessingOptions,
): Promise<ProcessedTemplate>;
/**
 * Process multiple templates in parallel.
 *
 * @param items - Array of resolved templates with their options
 * @returns Array of processed templates
 */
export declare function processTemplates(
  items: Array<{
    resolved: ResolvedTemplate;
    options: TemplateProcessingOptions;
  }>,
): Promise<ProcessedTemplate[]>;
/**
 * Check if a template format requires Handlebars processing.
 *
 * @param format - Template format
 * @returns true if Handlebars can be applied
 */
export declare function supportsHandlebars(format: TemplateFormat): boolean;
/**
 * Check if a template format produces HTML output.
 *
 * @param format - Template format
 * @returns true if the format produces HTML
 */
export declare function producesHtml(format: TemplateFormat): boolean;
/**
 * Check if a template format requires bundling.
 *
 * @param format - Template format
 * @returns true if the format needs to be bundled
 */
export declare function requiresBundling(format: TemplateFormat): boolean;
/**
 * Process an HTML template with Handlebars.
 *
 * @param content - HTML template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export declare function processHtmlTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string>;
/**
 * Process a Markdown template with Handlebars and marked.
 *
 * @param content - Markdown template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export declare function processMarkdownTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string>;
/**
 * Process an MDX template with Handlebars and MDX renderer.
 *
 * @param content - MDX template content
 * @param context - Processing context
 * @param helpers - Custom Handlebars helpers
 * @returns Processed HTML
 */
export declare function processMdxTemplate(
  content: string,
  context: TemplateProcessingOptions['context'],
  helpers?: TemplateProcessingOptions['handlebarsHelpers'],
): Promise<string>;
//# sourceMappingURL=template-processor.d.ts.map
