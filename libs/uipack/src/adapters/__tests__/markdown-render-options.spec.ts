/**
 * `ui.runtimeOptions.markdown` through renderToolTemplate: applied to a Markdown template, refused
 * on a template that isn't Markdown.
 */

import { describeRenderOptionProblems, prepareRenderOptions } from '../render-options';
import { renderToolTemplate } from '../template-renderer';

const SOURCE = '| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```';

function body(template: unknown, markdown?: { gfm?: boolean; highlightTheme?: string }, contentSecurity?: object) {
  const page = renderToolTemplate({
    toolName: 'report',
    input: {},
    output: {},
    template,
    markdown,
    contentSecurity,
  }).html;
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1] ?? '';
}

describe('runtimeOptions.markdown', () => {
  it('converts GitHub-flavored Markdown with gfm', () => {
    expect(body(SOURCE, { gfm: true })).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead>');
    expect(body(SOURCE)).toContain('<p>| a | b | |---|---| | 1 | 2 |</p>');
  });

  it('highlights fenced code and puts the theme stylesheet in the page with highlightTheme', () => {
    const markup = body(SOURCE, { highlightTheme: 'github' });
    expect(markup).toMatch(/^\s*<style>[^<]*\.hljs[^<]*<\/style>/);
    expect(markup).toContain(
      '<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;\n</code></pre>',
    );
  });

  it('keeps the theme stylesheet when the markup is sanitized', () => {
    expect(body(SOURCE, { highlightTheme: 'github' }, {})).toMatch(/^\s*<style>[^<]*\.hljs/);
  });

  it.each([
    ['an HTML string', '<p>x</p>', 'an HTML string'],
    ['a function', () => '# x', 'a function'],
    ['a { file } widget', { file: './w.tsx' }, 'a `{ file }` widget'],
  ])('refuses gfm or highlightTheme on %s', (_name, template, described) => {
    for (const markdown of [{ gfm: true }, { highlightTheme: 'github' }]) {
      expect(describeRenderOptionProblems(template, { markdown })).toEqual([
        expect.stringContaining(
          `\`ui.runtimeOptions.markdown\` applies to a Markdown template (a string without both \`<\` and \`>\`, or any template with \`uiType: 'markdown'\`) or an MDX template, and this template is ${described}.`,
        ),
      ]);
    }
    expect(describeRenderOptionProblems(template, { markdown: { gfm: false } })).toEqual([]);
  });

  it('loads the theme at startup, so a missing one fails before any call', async () => {
    await expect(prepareRenderOptions('# x', { markdown: { highlightTheme: 'nope' } })).rejects.toThrow(
      'not a highlight.js theme',
    );
    await expect(prepareRenderOptions('# x', { markdown: { highlightTheme: 'github-dark' } })).resolves.toBeUndefined();
  });
});
