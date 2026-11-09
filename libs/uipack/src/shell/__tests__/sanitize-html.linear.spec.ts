/**
 * The sanitizer's time grows linearly with the markup: each shape that once took seconds to minutes
 * on 1 MB (comments, raw-text elements, a dotted capital I) is sanitized well within a second.
 */

import { sanitizeHtml } from '../sanitize-html';

const ONE_MEGABYTE = 1024 * 1024;
// About 50 ms each on a developer machine; the bound leaves room for a loaded CI runner
const BOUND_MS = 3000;

const SHAPES: Array<[string, string]> = [
  ['plain markup', '<p class="x">hello <b>world</b></p>'],
  ['comments ending in --!>', '<!----!>'],
  ['empty comments', '<!---->'],
  ['bogus comments', '<!x>'],
  ['title elements', '<title></title>'],
  ['style elements', '<style></style>'],
  ['textarea elements', '<textarea>x</textarea>'],
  ['script elements', '<script></script>'],
  ['near-miss end tags in one title', '</titlex>'],
  ['dotted capital I in a title', '<title>İ</title>'],
  ['@import rules in a style element', '<style>@import url(x);a{b:c}</style>'],
  ['style attributes', '<p style="position:fixed;color:red;top:0">x</p>'],
  ['attributes with references', '<a href="&#106;&#97;x" title="&amp;&copy;">'],
  ['tool-call buttons', '<button data-tool-call="x" data-tool-args="{}">b</button>'],
];

function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.floor(length / unit.length));
}

describe('sanitizeHtml time', () => {
  it.each(SHAPES)('sanitizes 1 MB of %s in linear time', (_name, unit) => {
    const markup = unit === '</titlex>' ? `<title>${repeatTo(unit, ONE_MEGABYTE)}` : repeatTo(unit, ONE_MEGABYTE);
    const started = performance.now();
    sanitizeHtml(markup);
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
  });

  it('sanitizes 1 MB of one attribute list in linear time', () => {
    const markup = `<a${repeatTo(' a=b', ONE_MEGABYTE)}>`;
    const started = performance.now();
    sanitizeHtml(markup);
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
  });
});
