/**
 * Which rendering options a template can take.
 *
 * @packageDocumentation
 */

import type { RenderToolTemplateOptions } from './template-renderer';

function isFileTemplate(template: unknown): boolean {
  return typeof template === 'object' && template !== null && 'file' in template;
}

/**
 * The rendering options set for a template that it cannot take, one sentence each. The server
 * refuses to start a tool with any, and {@link renderToolTemplate} throws for them.
 */
export function describeRenderOptionProblems(
  template: unknown,
  options: Pick<RenderToolTemplateOptions, 'contentSecurity'>,
): string[] {
  const problems: string[] = [];
  if (options.contentSecurity && isFileTemplate(template)) {
    problems.push(
      '`ui.contentSecurity` sanitizes the markup FrontMCP builds on the server, and a `{ file }` widget is rendered ' +
        'in the page, so there is nothing for it to sanitize. Remove it, or use an HTML, Markdown or function template.',
    );
  }
  return problems;
}
