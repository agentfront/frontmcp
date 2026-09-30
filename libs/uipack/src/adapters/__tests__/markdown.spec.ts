import { markdownToHtml } from '../markdown';

describe('markdownToHtml', () => {
  it('converts headings', () => {
    expect(markdownToHtml('# Title\n\n### Sub')).toBe('<h1>Title</h1>\n<h3>Sub</h3>');
  });

  it('converts paragraphs and inline emphasis, code and links', () => {
    const out = markdownToHtml('Hello **bold** and *it* with `code` and [site](https://example.com).');
    expect(out).toBe(
      '<p>Hello <strong>bold</strong> and <em>it</em> with <code>code</code> and <a href="https://example.com" rel="noopener noreferrer">site</a>.</p>',
    );
  });

  it('converts unordered and ordered lists', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('converts fenced code blocks without touching their content', () => {
    expect(markdownToHtml('```\n**not bold** <b>\n```')).toBe('<pre><code>**not bold** &lt;b&gt;\n</code></pre>');
  });

  it('escapes raw HTML in the source', () => {
    const out = markdownToHtml('<script>alert(1)</script> & "q"');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('drops links with unsafe schemes', () => {
    const out = markdownToHtml('[x](javascript:alert(1))');
    expect(out).not.toContain('href');
    expect(out).toContain('x');
  });

  it('returns an empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('');
  });

  it('ignores placeholder-like characters in the input', () => {
    expect(markdownToHtml('a \uE0000\uE000 `x`')).toBe('<p>a 0 <code>x</code></p>');
  });
});
