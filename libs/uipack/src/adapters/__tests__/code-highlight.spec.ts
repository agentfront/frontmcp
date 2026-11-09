import { loadCodeHighlighter } from '../code-highlight';
import { requireFromProject } from '../project-require';

describe('loadCodeHighlighter', () => {
  it('highlights a language highlight.js knows, with the theme stylesheet', () => {
    const highlighter = loadCodeHighlighter('github');
    expect(highlighter.highlight('const a = "<b>";', 'ts')).toBe(
      '<span class="hljs-keyword">const</span> a = <span class="hljs-string">&quot;&lt;b&gt;&quot;</span>;',
    );
    expect(highlighter.highlight('x', 'not-a-language')).toBeUndefined();
    expect(highlighter.css).toContain('.hljs');
    expect(highlighter.css).not.toContain('<');
  });

  it('loads a theme from a subdirectory of highlight.js/styles', () => {
    expect(loadCodeHighlighter('base16/dracula').css).toContain('.hljs');
  });

  it.each(['no-such-theme', '../../package', 'github.min', '/etc/passwd'])(
    'refuses %s, which is not a theme',
    (theme) => {
      expect(() => loadCodeHighlighter(theme)).toThrow(
        `\`ui.runtimeOptions.markdown.highlightTheme\` is ${JSON.stringify(theme)}, which is not a highlight.js theme`,
      );
    },
  );
});

describe('requireFromProject', () => {
  it('names the package to install when it is missing', () => {
    expect(() => requireFromProject('@frontmcp-missing/peer/sub', 'An option')).toThrow(
      'An option needs @frontmcp-missing/peer, which is not installed. Install it where the server runs: `npm install @frontmcp-missing/peer`.',
    );
  });

  it('loads a package of the project, ES modules included', () => {
    expect(typeof requireFromProject<{ compileSync: unknown }>('@mdx-js/mdx', 'x').compileSync).toBe('function');
  });
});
