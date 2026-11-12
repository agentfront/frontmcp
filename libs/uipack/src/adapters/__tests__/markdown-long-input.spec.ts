/**
 * Markdown whose links, bare URLs or table rows never complete is read in one pass: these documents
 * took time growing with the square of their length.
 */
import { markdownToHtml } from '../markdown';

const gfm = (source: string) => markdownToHtml(source, { gfm: true });

describe('markdownToHtml on long unfinished constructs', () => {
  it('leaves 200,000 opening brackets as text', () => {
    const source = '['.repeat(200_000);

    expect(markdownToHtml(source)).toBe(`<p>${source}</p>`);
  });

  it('leaves links whose href never closes as text', () => {
    const source = `[a](${'x[a]('.repeat(50_000)}`;

    expect(markdownToHtml(source)).toBe(`<p>${source}</p>`);
  });

  it.each([
    ['unmatched parentheses', ')', ')'],
    ['trailing punctuation', '.', '.'],
    ['quotes, which end it as character references', '"', '&quot;'],
  ])('links a bare URL followed by 100,000 %s', (_label, character, escaped) => {
    expect(gfm(`https://example.com/x${character.repeat(100_000)}`)).toBe(
      `<p><a href="https://example.com/x" rel="noopener noreferrer">https://example.com/x</a>${escaped.repeat(100_000)}</p>`,
    );
  });

  it('reads a long line of spaces after a row with a pipe as a paragraph', () => {
    expect(gfm(`a | b\n${' '.repeat(100_000)}x`)).toBe('<p>a | b x</p>');
  });

  it('keeps the links it made before', () => {
    expect(markdownToHtml('[a[b](https://example.com/?filter[x]=1) and [c](http://[::1]/)')).toBe(
      '<p><a href="https://example.com/?filter[x]=1" rel="noopener noreferrer">a[b</a> and ' +
        '<a href="http://[::1]/" rel="noopener noreferrer">c</a></p>',
    );
    expect(gfm('see https://example.com/a_(b)). and www.example.com/"x".')).toBe(
      '<p>see <a href="https://example.com/a_(b)" rel="noopener noreferrer">https://example.com/a_(b)</a>). and ' +
        '<a href="http://www.example.com/&quot;x" rel="noopener noreferrer">www.example.com/&quot;x</a>&quot;.</p>',
    );
  });
});
