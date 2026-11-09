/**
 * Syntax highlighting for `ui.runtimeOptions.markdown.highlightTheme`, with highlight.js.
 *
 * @packageDocumentation
 */

import { requireFromProject, resolveFromProject } from './project-require';

/** The parts of highlight.js this uses. */
interface HighlightJs {
  getLanguage(name: string): unknown;
  highlight(code: string, options: { language: string; ignoreIllegals: boolean }): { value: string };
}

/** A highlighter for one theme. */
export interface CodeHighlighter {
  /** The code as highlighted HTML, or `undefined` for a language highlight.js doesn't know. */
  highlight(code: string, language: string): string | undefined;
  /** The theme's stylesheet. */
  css: string;
}

const PURPOSE = '`ui.runtimeOptions.markdown.highlightTheme`';
const THEME_NAME = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/i;
const highlighters = new Map<string, CodeHighlighter>();

/**
 * The highlighter for a highlight.js theme, such as `'github'`, `'github-dark'` or
 * `'base16/dracula'`: the name of a stylesheet in `highlight.js/styles`.
 *
 * @throws When highlight.js isn't installed or has no such theme
 */
export function loadCodeHighlighter(theme: string): CodeHighlighter {
  const loaded = highlighters.get(theme);
  if (loaded) return loaded;

  const hljs = requireFromProject<HighlightJs>('highlight.js', PURPOSE);
  const highlighter: CodeHighlighter = {
    highlight: (code, language) =>
      hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : undefined,
    css: readTheme(theme),
  };
  highlighters.set(theme, highlighter);
  return highlighter;
}

function readTheme(theme: string): string {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const styles = path.join(path.dirname(resolveFromProject('highlight.js/package.json', PURPOSE)), 'styles');
  const file = path.join(styles, `${theme}.min.css`);
  if (!THEME_NAME.test(theme) || !fs.existsSync(file)) {
    throw new Error(
      `${PURPOSE} is ${JSON.stringify(theme)}, which is not a highlight.js theme: name a stylesheet in ` +
        `highlight.js/styles without its extension, such as "github", "github-dark" or "base16/dracula".`,
    );
  }
  return fs.readFileSync(file, 'utf-8');
}
