/**
 * MDX templates: a string template compiled with `@mdx-js/mdx` and rendered on the server with
 * React, with `ui.mdxComponents` as its components.
 *
 * @packageDocumentation
 */

import type { CodeHighlighter } from './code-highlight';
import { preloadFromProject, requireFromProject } from './project-require';
import { loadServerReact, type ReactApi } from './server-react';

interface MdxCompiler {
  compileSync(source: string, options: Record<string, unknown>): { toString(): string };
}

/** The compiled template: given the JSX runtime and the call's data, its module, whose default export is the content. */
type MdxModule = (runtime: unknown, input: unknown, output: unknown, helpers: unknown) => { default: unknown };

const PURPOSE = 'An MDX template';
const compiledTemplates = new Map<string, MdxModule>();

/** Import the ES modules an MDX template compiles with, before it is compiled synchronously. */
export async function preloadMdxCompiler(gfm = false): Promise<void> {
  await preloadFromProject('@mdx-js/mdx', PURPOSE);
  if (gfm) await preloadFromProject('remark-gfm', `${PURPOSE} with \`gfm\``);
}

/**
 * Compile an MDX template, once per source. Its expressions see `input`, `output` and `helpers`.
 *
 * @throws On an MDX syntax error, on an `import` (the template has no module to import from), or
 *   when `@mdx-js/mdx` (or `remark-gfm` for `gfm`) isn't installed
 */
export function compileMdxTemplate(source: string, gfm = false): MdxModule {
  const key = `${gfm}:${source}`;
  const cached = compiledTemplates.get(key);
  if (cached) return cached;

  const { compileSync } = requireFromProject<MdxCompiler>('@mdx-js/mdx', PURPOSE);
  const remarkPlugins = gfm
    ? [requireFromProject<{ default: unknown }>('remark-gfm', `${PURPOSE} with \`gfm\``).default]
    : [];
  const body = String(compileSync(source, { outputFormat: 'function-body', development: false, remarkPlugins }));
  // The template is the tool author's code; the call's data reaches it only as values, never as source
  const compiled = new Function('__mdxRuntime', 'input', 'output', 'helpers', body) as MdxModule;
  compiledTemplates.set(key, compiled);
  return compiled;
}

export interface RenderMdxOptions {
  input: unknown;
  output: unknown;
  helpers: unknown;
  /** `ui.mdxComponents`: the components the template's tags name, and overrides of HTML elements. */
  components?: Record<string, unknown>;
  gfm?: boolean;
  /** Highlights fenced code that names its language. */
  highlighter?: CodeHighlighter;
}

/** Render an MDX template to static HTML on the server. */
export function renderMdxTemplate(source: string, options: RenderMdxOptions): string {
  const compiled = compileMdxTemplate(source, options.gfm);
  const { react, jsxRuntime, server } = loadServerReact(PURPOSE);

  const { default: content } = compiled(jsxRuntime, options.input, options.output, options.helpers);
  const components = {
    ...(options.highlighter ? { code: highlightedCode(react, options.highlighter) } : {}),
    ...options.components,
  };
  return server.renderToStaticMarkup(react.createElement(content, { components }));
}

/** A `code` element that highlights fenced code naming its language, as the Markdown converter does. */
function highlightedCode(react: ReactApi, highlighter: CodeHighlighter) {
  return (props: { className?: string; children?: unknown }) => {
    const language = /\blanguage-([\w#+.-]+)/.exec(props.className ?? '')?.[1];
    const highlighted =
      language && typeof props.children === 'string' ? highlighter.highlight(props.children, language) : undefined;
    if (highlighted === undefined) return react.createElement('code', props);
    return react.createElement('code', {
      className: `hljs ${props.className}`,
      dangerouslySetInnerHTML: { __html: highlighted },
    });
  };
}
