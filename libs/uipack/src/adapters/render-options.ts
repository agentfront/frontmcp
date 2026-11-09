/**
 * Which rendering options a template can take.
 *
 * @packageDocumentation
 */

import type { UIType } from '../types/ui-runtime';
import { loadCodeHighlighter } from './code-highlight';
import { compileMdxTemplate, loadMdxRuntime, preloadMdxCompiler } from './mdx';
import type { RenderToolTemplateOptions } from './template-renderer';
import { detectUIType } from './type-detector';

type RenderOptions = Pick<RenderToolTemplateOptions, 'contentSecurity' | 'markdown' | 'mdxComponents'>;

/** How the template renders: a string template is MDX with `mdxComponents`, else as detected. */
export function resolveUiType(template: unknown, options: RenderOptions): UIType {
  return typeof template === 'string' && options.mdxComponents ? 'mdx' : detectUIType(template);
}

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
  if (options.mdxComponents && typeof template !== 'string') {
    problems.push(
      `\`ui.mdxComponents\` is for an MDX template, which is a string, and this template is ${describeTemplate(template)}. ` +
        "A template function's result is never compiled as MDX: it carries the call's data, and compiling it would run " +
        'that data as code. Write the template as a string and read the data in expressions, such as `{output.title}`.',
    );
  }
  const uiType = resolveUiType(template, options);
  const convertsMarkdown = typeof template === 'string' && (uiType === 'markdown' || uiType === 'mdx');
  if ((options.markdown?.gfm || options.markdown?.highlightTheme) && !convertsMarkdown) {
    problems.push(
      '`ui.runtimeOptions.markdown` applies to a Markdown template, a string without both `<` and `>`, or an MDX ' +
        `template, and this template is ${describeTemplate(template)}. Remove it, or write the template in Markdown.`,
    );
  }
  return problems;
}

/**
 * Load what the options need to render the template, so a missing package or theme fails at
 * startup instead of at the first call, and compile an MDX template. Call it before rendering an
 * MDX template under a loader that can't `require` an ES module graph, such as tsx.
 *
 * @throws When an optional package the options need isn't installed, a theme doesn't exist, or an
 *   MDX template doesn't compile
 */
export async function prepareRenderOptions(template: unknown, options: RenderOptions): Promise<void> {
  const uiType = resolveUiType(template, options);
  if (typeof template !== 'string' || (uiType !== 'markdown' && uiType !== 'mdx')) return;
  if (options.markdown?.highlightTheme) loadCodeHighlighter(options.markdown.highlightTheme);
  if (uiType === 'mdx') {
    loadMdxRuntime();
    await preloadMdxCompiler(options.markdown?.gfm);
    compileMdxTemplate(template, options.markdown?.gfm);
  }
}

function describeTemplate(template: unknown): string {
  if (typeof template === 'string') return 'an HTML string';
  if (typeof template === 'function') return 'a function';
  return isFileTemplate(template) ? 'a `{ file }` widget' : 'not a string';
}
