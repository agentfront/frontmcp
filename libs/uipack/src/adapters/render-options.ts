/**
 * Which rendering options a template can take.
 *
 * @packageDocumentation
 */

import type { UIType } from '../types/ui-runtime';
import { loadCodeHighlighter } from './code-highlight';
import { compileMdxTemplate, preloadMdxCompiler } from './mdx';
import { loadServerReact } from './server-react';
import type { RenderToolTemplateOptions } from './template-renderer';
import { detectUIType } from './type-detector';

type RenderOptions = Pick<
  RenderToolTemplateOptions,
  'contentSecurity' | 'markdown' | 'mdxComponents' | 'uiType' | 'hydrate'
>;

/** `ui.uiType` when it names a renderer, `undefined` for `'auto'` or unset. */
export function forcedUiType(options: Pick<RenderOptions, 'uiType'>): Exclude<UIType, 'auto'> | undefined {
  return options.uiType && options.uiType !== 'auto' ? options.uiType : undefined;
}

/** How the template renders: as `ui.uiType` says, as MDX for a string with `mdxComponents`, else as detected. */
export function resolveUiType(template: unknown, options: RenderOptions): UIType {
  const forced = forcedUiType(options);
  if (forced) return forced;
  return typeof template === 'string' && options.mdxComponents ? 'mdx' : detectUIType(template);
}

function isFileTemplate(template: unknown): boolean {
  return typeof template === 'object' && template !== null && 'file' in template;
}

function isJsxFileTemplate(template: unknown): boolean {
  return isFileTemplate(template) && /\.(tsx|jsx)$/i.test(String((template as { file: unknown }).file));
}

/** A class component, or the object `React.memo()` / `React.forwardRef()` return. */
function isComponentObjectOrClass(template: unknown): boolean {
  if (typeof template === 'object' && template !== null) return '$$typeof' in template;
  const prototype = typeof template === 'function' ? template.prototype : undefined;
  return typeof prototype?.render === 'function' || Boolean(prototype?.isReactComponent);
}

function isComponentReference(template: unknown, options: RenderOptions): boolean {
  if (isComponentObjectOrClass(template)) return true;
  return typeof template === 'function' && resolveUiType(template, options) === 'react';
}

/**
 * The rendering options set for a template that it cannot take, one sentence each. The server
 * refuses to start a tool with any, and {@link renderToolTemplate} throws for them.
 */
export function describeRenderOptionProblems(template: unknown, options: RenderOptions): string[] {
  const problems: string[] = [];
  const forced = forcedUiType(options);
  const uiTypeProblem = forced && describeUiTypeMismatch(forced, template);
  if (uiTypeProblem) problems.push(`\`ui.uiType: '${forced}'\` ${uiTypeProblem}`);

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
  } else if (options.mdxComponents && forced && forced !== 'mdx') {
    problems.push(`\`ui.mdxComponents\` is for an MDX template, and \`ui.uiType\` is '${forced}'.`);
  }

  const uiType = resolveUiType(template, options);
  const convertsMarkdown =
    (uiType === 'markdown' && (typeof template === 'string' || typeof template === 'function')) ||
    (uiType === 'mdx' && typeof template === 'string');
  if ((options.markdown?.gfm || options.markdown?.highlightTheme) && !convertsMarkdown) {
    problems.push(
      '`ui.runtimeOptions.markdown` applies to a Markdown template (a string without both `<` and `>`, or any ' +
        `template with \`uiType: 'markdown'\`) or an MDX template, and this template is ${describeTemplate(template)}. ` +
        'Remove it, or write the template in Markdown.',
    );
  }

  if (options.hydrate && !isJsxFileTemplate(template)) {
    problems.push(
      isComponentReference(template, options)
        ? "`ui.hydrate` needs the component's code in the page, and a component reference has no source file to " +
            "bundle. Use `template: { file: './widget.tsx' }`, or remove `hydrate` and set `uiType: 'react'` to render " +
            'it on the server only.'
        : '`ui.hydrate` hydrates a React widget rendered on the server, a `{ file }` .tsx or .jsx widget, and this ' +
            `template is ${uiType === 'mdx' ? 'an MDX template, which renders to static HTML' : describeTemplate(template)}.`,
    );
  }
  return problems;
}

/** Why a template can't render with the `ui.uiType` it forces, or `undefined` when it can. */
function describeUiTypeMismatch(uiType: Exclude<UIType, 'auto'>, template: unknown): string | undefined {
  if (uiType === 'react') {
    if (typeof template === 'function' || isComponentObjectOrClass(template) || isJsxFileTemplate(template)) return;
    return (
      'renders a React component (a component reference, or a `{ file }` .tsx or .jsx widget), and this template ' +
      `is ${isFileTemplate(template) ? 'a `{ file }` that is not a .tsx or .jsx file' : describeTemplate(template)}.`
    );
  }
  if (uiType === 'mdx') {
    return typeof template === 'string'
      ? undefined
      : `renders an MDX template, which is a string, and this template is ${describeTemplate(template)}.`;
  }
  if (typeof template === 'string' || (typeof template === 'function' && !isComponentObjectOrClass(template))) return;
  return `renders a string or a template function, and this template is ${describeTemplate(template)}.`;
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
  if (options.markdown?.highlightTheme && (uiType === 'markdown' || uiType === 'mdx')) {
    loadCodeHighlighter(options.markdown.highlightTheme);
  }
  if (uiType === 'mdx' && typeof template === 'string') {
    loadServerReact('An MDX template');
    await preloadMdxCompiler(options.markdown?.gfm);
    compileMdxTemplate(template, options.markdown?.gfm);
  }
  if (forcedUiType(options) === 'react' && !isFileTemplate(template)) loadServerReact("`ui.uiType: 'react'`");
  if (options.hydrate) loadServerReact('`ui.hydrate`');
}

function describeTemplate(template: unknown): string {
  if (typeof template === 'string') return detectUIType(template) === 'html' ? 'an HTML string' : 'a Markdown string';
  if (isComponentObjectOrClass(template)) return 'a React component';
  if (typeof template === 'function') return 'a function';
  return isFileTemplate(template) ? 'a `{ file }` widget' : 'not a string';
}
