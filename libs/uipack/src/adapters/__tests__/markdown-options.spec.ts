import { markdownToHtml } from '../markdown';

const gfm = (source: string) => markdownToHtml(source, { gfm: true });

describe('markdownToHtml with gfm', () => {
  it('converts a table, with its column alignments', () => {
    expect(gfm('| Region | Sales | Share |\n|:---|---:|:---:|\n| EU | **12** | `a\\|b` |\n| US | 30 |')).toBe(
      '<table><thead><tr><th align="left">Region</th><th align="right">Sales</th><th align="center">Share</th></tr></thead>' +
        '<tbody><tr><td align="left">EU</td><td align="right"><strong>12</strong></td><td align="center"><code>a|b</code></td></tr>' +
        '<tr><td align="left">US</td><td align="right">30</td><td align="center"></td></tr></tbody></table>',
    );
  });

  it('ends a table at a blank line, and writes no body for a header alone', () => {
    expect(gfm('a | b\n--- | ---\n\nafter')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead></table>\n<p>after</p>',
    );
  });

  it('needs a delimiter row with as many cells as the header', () => {
    expect(gfm('| a | b |\n|---|\n| 1 | 2 |')).toBe('<p>| a | b | |---| | 1 | 2 |</p>');
  });

  it('converts task list items', () => {
    expect(gfm('- [x] shipped\n- [ ] *pending*\n- plain')).toBe(
      '<ul><li class="task-list-item"><input type="checkbox" disabled checked> shipped</li>' +
        '<li class="task-list-item"><input type="checkbox" disabled> <em>pending</em></li><li>plain</li></ul>',
    );
  });

  it('converts strikethrough', () => {
    expect(gfm('~~old~~ new')).toBe('<p><del>old</del> new</p>');
  });

  it('links bare URLs, leaving trailing punctuation and unmatched parentheses out', () => {
    expect(gfm('See https://example.com/a?b=1&c=2, www.example.com. (https://example.com/x_(y))')).toBe(
      '<p>See <a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">https://example.com/a?b=1&amp;c=2</a>, ' +
        '<a href="http://www.example.com" rel="noopener noreferrer">www.example.com</a>. ' +
        '(<a href="https://example.com/x_(y)" rel="noopener noreferrer">https://example.com/x_(y)</a>)</p>',
    );
  });

  it('links no URL inside a link or code span, and none that is not http(s)', () => {
    expect(gfm('[https://a.example](https://b.example) `https://c.example` javascript:alert(1)')).toBe(
      '<p><a href="https://b.example" rel="noopener noreferrer">https://a.example</a> <code>https://c.example</code> javascript:alert(1)</p>',
    );
  });

  it('keeps a quote out of a bare URL', () => {
    expect(gfm('"https://example.com"')).toBe(
      '<p>&quot;<a href="https://example.com" rel="noopener noreferrer">https://example.com</a>&quot;</p>',
    );
  });

  it('still escapes raw HTML, in cells too', () => {
    const out = gfm('<script>alert(1)</script>\n\n| a |\n|---|\n| <img src=x onerror=alert(1)> |');
    expect(out).not.toMatch(/<script|<img/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves the GitHub-flavored syntax as text without gfm', () => {
    expect(markdownToHtml('~~old~~ https://example.com\n\n- [x] done')).toBe(
      '<p>~~old~~ https://example.com</p>\n<ul><li>[x] done</li></ul>',
    );
  });
});

describe('markdownToHtml with a highlighter', () => {
  const highlight = (code: string, language: string) =>
    language === 'ts' ? `<span class="hljs-keyword">${code}</span>` : undefined;

  it('highlights fenced code that names a language the highlighter knows', () => {
    expect(markdownToHtml('```ts\nconst\n```', { highlight })).toBe(
      '<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span>\n</code></pre>',
    );
  });

  it('escapes code in a language it does not know, or without a language', () => {
    expect(markdownToHtml('```cobol\n<b>\n```\n\n```\n<i>\n```', { highlight })).toBe(
      '<pre><code class="hljs language-cobol">&lt;b&gt;\n</code></pre>\n<pre><code class="hljs">&lt;i&gt;\n</code></pre>',
    );
  });

  it('keeps only safe characters of the language name', () => {
    expect(markdownToHtml('```ts"onload=x\ncode\n```', { highlight })).toContain('class="hljs language-ts"');
  });
});
