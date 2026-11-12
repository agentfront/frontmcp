/**
 * The math renderer finds its delimiters in one pass: the spans are those of the expression it used
 * before, and a document full of delimiters without closers is read once instead of once per delimiter.
 */
import { isMath } from '../math';
import { findMathSpans } from '../math/math-spans';

const PREVIOUS_EXPRESSION =
  /(\$\$(?:[^$]|\$(?!\$))+\$\$|\$[^$\n]+?\$|\\\[(?:[^\\]|\\.)*\\\]|\\\((?:[^\\]|\\.)*\\\)|\\begin\{(?:[^\\]|\\.)*\\end\{[^}]+\})/gs;

const PIECES = [
  '$',
  '$$',
  '\\',
  '\\[',
  '\\]',
  '\\(',
  '\\)',
  '\\begin{',
  '\\end{',
  '}',
  '{',
  'a',
  'x',
  ' ',
  '\n',
  '\\\\',
];

/** Spans of the previous expression, for comparison on short inputs. */
function previousSpans(source: string): Array<{ start: number; end: number }> {
  return [...source.matchAll(PREVIOUS_EXPRESSION)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** Deterministic pseudo-random documents built from delimiter pieces. */
function generatedDocuments(count: number): string[] {
  let seed = 12345;
  const next = (limit: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % limit;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + next(14) }, () => PIECES[next(PIECES.length)]).join(''),
  );
}

describe('math delimiter spans', () => {
  it.each([
    ['$$E = mc^2$$ and $x$'],
    ['\\[a\\] text \\[b\\]'],
    ['\\(x^2\\) and \\\\(y\\)'],
    ['\\begin{align}a &= b\\end{align} then \\begin{x}\\end{}'],
    ['price $5 and $6\n$7'],
    ['$$$$ $$a$$$'],
  ])('match the previous expression on %j', (source) => {
    expect(findMathSpans(source)).toEqual(previousSpans(source));
  });

  it('match the previous expression on generated documents', () => {
    for (const source of generatedDocuments(5000)) {
      expect({ source, spans: findMathSpans(source) }).toEqual({ source, spans: previousSpans(source) });
    }
  });

  it.each([
    ['\\[', '\\['.repeat(200000)],
    ['\\(', '\\('.repeat(200000)],
    ['\\begin{ and \\end{', '\\begin{'.repeat(20000) + '\\end{a'.repeat(20000)],
  ])('read a document of %s without closers once', (_label, source) => {
    expect(findMathSpans(source)).toEqual([]);
    expect(isMath(source)).toBe(false);
  });
});
