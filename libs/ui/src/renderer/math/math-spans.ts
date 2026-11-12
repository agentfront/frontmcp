/**
 * Math delimiters found in one pass over the source. The spans are the matches of
 * /\$\$(?:[^$]|\$(?!\$))+\$\$|\$[^$\n]+?\$|\\\[(?:[^\\]|\\.)*\\\]|\\\((?:[^\\]|\\.)*\\\)|\\begin\{(?:[^\\]|\\.)*\\end\{[^}]+\}/gs
 * without its backtracking, which reads the rest of the source again for every delimiter that has no closer.
 */

/** Start and end positions of a math span in the source, delimiters included. */
export interface MathSpan {
  start: number;
  end: number;
}

/** Position of the last backslash escape of `closer`, reading each backslash as escaping the next character; -1 if none. */
function lastEscapeOf(source: string, closer: string): number {
  let last = -1;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\\') continue;
    if (source[index + 1] === closer) last = index;
    index++;
  }
  return last;
}

/** Position of the backslash of the last `\end{name}` followed by a closing brace, read as `lastEscapeOf` reads; -1 if none. */
function lastEnvironmentEnd(source: string): number {
  const lastBrace = source.lastIndexOf('}');
  let last = -1;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\\') continue;
    const nameStart = index + 5;
    if (source.startsWith('end{', index + 1) && nameStart < lastBrace && source[nameStart] !== '}') last = index;
    index++;
  }
  return last;
}

/** Whether the source has a backslash-escaped `opener` with a backslash-escaped `closer` after it. */
export function hasEscapedPair(source: string, opener: string, closer: string): boolean {
  const start = source.indexOf(`\\${opener}`);
  return start !== -1 && lastEscapeOf(source, closer) >= start + 2;
}

/** Create a finder of the end of the math span that starts at a position (-1 if none), for positions that never decrease. */
function createMathSpanFinder(source: string): (index: number) => number {
  const bracketClose = lastEscapeOf(source, ']');
  const parenClose = lastEscapeOf(source, ')');
  const environmentEnd = lastEnvironmentEnd(source);
  let nextDoubleDollar = -2;

  return (index) => {
    if (source.startsWith('$$', index)) {
      if (nextDoubleDollar !== -1 && nextDoubleDollar < index + 2) nextDoubleDollar = source.indexOf('$$', index + 2);
      if (nextDoubleDollar > index + 2) return nextDoubleDollar + 2;
    }
    if (source[index] === '$') {
      let close = index + 1;
      while (close < source.length && source[close] !== '$' && source[close] !== '\n') close++;
      if (source[close] === '$' && close > index + 1) return close + 1;
    }
    if (source.startsWith('\\[', index) && bracketClose >= index + 2) return bracketClose + 2;
    if (source.startsWith('\\(', index) && parenClose >= index + 2) return parenClose + 2;
    if (source.startsWith('\\begin{', index) && environmentEnd >= index + 7) {
      return source.indexOf('}', environmentEnd + 6) + 1;
    }
    return -1;
  };
}

/** Find the math spans of the source, left to right and without overlap. */
export function findMathSpans(source: string): MathSpan[] {
  const findSpanEnd = createMathSpanFinder(source);
  const spans: MathSpan[] = [];
  for (let index = 0; index < source.length; index++) {
    const end = findSpanEnd(index);
    if (end === -1) continue;
    spans.push({ start: index, end });
    index = end - 1;
  }
  return spans;
}
