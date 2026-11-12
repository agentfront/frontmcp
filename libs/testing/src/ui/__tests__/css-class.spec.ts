import { UIAssertions } from '../ui-assertions';
import { uiMatchers } from '../ui-matchers';

/** Run the toHaveCssClass matcher outside expect, returning whether it passed. */
function matcherPasses(html: string, className: string): boolean {
  const toHaveCssClass = uiMatchers.toHaveCssClass as (received: unknown, className: string) => { pass: boolean };
  return toHaveCssClass.call({}, html, className).pass;
}

describe('CSS class checks', () => {
  const cases: Array<[string, string, boolean]> = [
    ['<div class="card btn primary">', 'btn', true],
    ["<div className='x Btn y'>", 'btn', true],
    ['<div class="btn-primary">', 'btn', true],
    ['<div class="btnx">', 'btn', false],
    ['<p>btn</p>', 'btn', false],
    ['<div class="a" data-x="btn">', 'btn', false],
    ['<i class="a"></i><b class = "x.y">', 'x.y', true],
  ];

  it.each(cases)('%s with %s: %p', (html, className, expected) => {
    expect(matcherPasses(html, className)).toBe(expected);
    if (expected) expect(() => UIAssertions.assertHasCssClass(html, className)).not.toThrow();
    else
      expect(() => UIAssertions.assertHasCssClass(html, className)).toThrow(
        `Expected HTML to have CSS class "${className}"`,
      );
  });

  it('answers at once for a class attribute that is never closed and repeats the class name', () => {
    const html = `<div class="${'card '.repeat(50000)}`;
    expect(matcherPasses(html, 'card')).toBe(false);
    expect(() => UIAssertions.assertHasCssClass(html, 'card')).toThrow('Expected HTML to have CSS class "card"');
  });
});
