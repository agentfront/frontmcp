/**
 * Which rendering options a template can take.
 *
 * @packageDocumentation
 */

import { loadCodeHighlighter } from './code-highlight';
import type { RenderToolTemplateOptions } from './template-renderer';
import { detectUIType } from './type-detector';

type RenderOptions = Pick<RenderToolTemplateOptions, 'contentSecurity' | 'markdown'>;

function isFileTemplate(template: unknown): boolean {
  return typeof template === 'object' && template !== null && 'file' in template;
}

/**
 * The rendering options set for a template that it cannot take, one sentence each. The server
 * refuses to start a tool with any, and {@link renderToolTemplate} throws for them.
 */
export function describeRenderOptionProblems(template: unknown, options: RenderOptions): string[] {
  const problems: string[] = [];
  if (options.contentSecurity && isFileTemplate(template)) {
    problems.push(
      '`ui.contentSecurity` sanitizes the markup FrontMCP builds on the server, and a `{ file }` widget is rendered ' +
        'in the page, so there is nothing for it to sanitize. Remove it, or use an HTML, Markdown or function template.',
    );
  }
  if ((options.markdown?.gfm || options.markdown?.highlightTheme) && !isMarkdownTemplate(template)) {
    problems.push(
      '`ui.runtimeOptions.markdown` applies to a Markdown template, a string without both `<` and `>`, and this ' +
        `template is ${describeTemplate(template)}. Remove it, or write the template in Markdown.`,
    );
  }
  return problems;
}

/**
 * Load what the options need to render the template, so a missing package or theme fails at
 * startup instead of at the first call.
 *
 * @throws When an optional package the options need isn't installed, or a theme doesn't exist
 */
export function prepareRenderOptions(template: unknown, options: RenderOptions): void {
  const theme = options.markdown?.highlightTheme;
  if (theme && isMarkdownTemplate(template)) loadCodeHighlighter(theme);
}

function isMarkdownTemplate(template: unknown): boolean {
  return typeof template === 'string' && detectUIType(template) === 'markdown';
}

function describeTemplate(template: unknown): string {
  if (typeof template === 'string') return 'an HTML string';
  if (typeof template === 'function') return 'a function';
  return isFileTemplate(template) ? 'a `{ file }` widget' : 'not a string';
}
