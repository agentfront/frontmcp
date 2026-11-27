import { InvalidInputError } from '@frontmcp/sdk';

import { grepMatcher, GrepRegex, MAX_GREP_STEPS } from '../grep-pattern';

const texts = [
  '',
  'timeout after 30s',
  'ERROR: disk full',
  'warn: Disk at 91%',
  'order-2026-11-26 shipped',
  'alice@example.com wrote',
  'a.b.c',
  'tab\there',
  'line one\nline two',
  'xxxxxxxxy',
  'Error [E42] at row 7',
  'überall',
  'ΟΔΟΣ',
  'οδος',
  'σοφία',
  'a{10000}',
];

describe('GrepRegex', () => {
  it.each([
    ['timeout', ''],
    ['^ERROR', ''],
    ['full$', ''],
    ['disk', 'i'],
    ['\\d{4}-\\d{2}-\\d{2}', ''],
    ['\\w+@\\w+\\.com', ''],
    ['err(or)?\\b', 'i'],
    ['ERROR|WARN', 'i'],
    ['a\\.b', ''],
    ['[0-9]+%', ''],
    ['[^a-z ]', ''],
    ['[^a-z]', 'i'],
    ['\\[E\\d+\\]', ''],
    ['x+x+y', ''],
    ['x{2,3}y', ''],
    ['x{9}', ''],
    ['x{3,}y', ''],
    ['(?:one|two)$', ''],
    ['\\t', ''],
    ['line.two', ''],
    ['\\Bxy', ''],
    ['\\s\\S', ''],
    ['[\\d.]+', ''],
    ['a-', ''],
    ['[a-]', ''],
    ['{x', ''],
    ['x*?y', ''],
    ['', ''],
    ['ü', 'i'],
    ['(a|b)*c', ''],
    ['σ', 'i'],
    ['ς', 'i'],
    ['Σ', 'i'],
    ['[σ]', 'i'],
    ['σ', ''],
    ['a{,5}', ''],
  ])('matches %j (%s) as a JavaScript RegExp does', (pattern, flags) => {
    const grep = new GrepRegex(pattern, flags === 'i');
    const native = new RegExp(pattern, flags);
    for (const text of texts) expect([text, grep.test(text)]).toEqual([text, native.test(text)]);
  });

  it.each([
    ['(a', 'an unclosed "("'],
    ['a)', 'an unmatched ")"'],
    ['[ab', 'an unclosed "["'],
    ['*a', 'nothing to repeat'],
    ['a**', 'nothing to repeat'],
    ['a{2}{3}', 'nothing to repeat'],
    ['^*', 'a quantifier on an anchor'],
    ['(?=a)', 'a lookaround or a named group'],
    ['(a)\\1', '"\\1", which grep does not run'],
    ['\\p{L}', '"\\p", which grep does not run'],
    ['a{1,101}', 'a repeat count over 100'],
    ['a{10000}', 'a repeat count over 100'],
    ['a{1,10000}', 'a repeat count over 100'],
    ['a{100000000000000000000}', 'a repeat count over 100'],
    ['(?:(?:(?:){100}){100}){100}', 'more than 20000 parts once its repeats are spelled out'],
    ['a{3,2}', 'a repeat range out of order'],
    ['[z-a]', 'a range out of order'],
    ['a\\', 'a "\\" at its end'],
    ['((a{100}){100})', 'more than 2000 steps'],
  ])('refuses %j: %s', (pattern, problem) => {
    expect(() => new GrepRegex(pattern)).toThrow(InvalidInputError);
    expect(() => new GrepRegex(pattern)).toThrow(problem);
  });

  it('runs in time linear in its text, where a backtracking RegExp takes minutes', () => {
    const started = Date.now();
    expect(new GrepRegex('x+x+y').test('x'.repeat(100_000))).toBe(false);
    expect(new GrepRegex('(a|a)*b').test('a'.repeat(100_000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it(`stops past ${MAX_GREP_STEPS} steps, saying how to narrow the search`, () => {
    const regex = new GrepRegex('.{0,100}z');
    const text = 'y'.repeat(10_000);

    expect(() => {
      for (let round = 0; round < 100; round++) regex.test(text);
    }).toThrow(/grep stopped after 20000000 steps: search a deeper path or a field, or use a literal pattern/);
  });
});

describe('grepMatcher', () => {
  it('matches a literal, with no regex syntax', () => {
    const matches = grepMatcher({ pattern: 'a.b' });
    expect(matches('xa.by')).toBe(true);
    expect(matches('axb')).toBe(false);
    expect(grepMatcher({ pattern: '(a+)+' })('(a+)+ literal')).toBe(true);
  });

  it('matches a literal in any case with ignoreCase', () => {
    expect(grepMatcher({ pattern: 'Disk' })('disk full')).toBe(false);
    expect(grepMatcher({ pattern: 'Disk', ignoreCase: true })('DISK full')).toBe(true);
  });

  it('folds case on both sides as RegExp does, so σ finds a final ς', () => {
    expect(grepMatcher({ pattern: 'σ', ignoreCase: true })('ΟΔΟΣ')).toBe(true);
    expect(grepMatcher({ pattern: 'σ', ignoreCase: true })('οδος')).toBe(true);
    expect(grepMatcher({ pattern: 'σ' })('οδος')).toBe(false);
  });

  it('matches a regex with regex: true', () => {
    expect(grepMatcher({ pattern: '^\\d+$', regex: true })('2026')).toBe(true);
    expect(grepMatcher({ pattern: '^\\d+$', regex: true })('20x26')).toBe(false);
  });
});
