/**
 * @jest-environment jsdom
 */
/**
 * `html` / `trustedHtml` — the explicit trusted-markup API for UI templates (#601).
 */
import { createTemplateHelpers, html, isTrustedHtml, trustedHtml, type TrustedHtml } from '../index';

const PAYLOAD = '<img src=x onerror="window.__trusted_html_xss=1">';

function parse(markup: TrustedHtml | string): Document {
  return new DOMParser().parseFromString(`<body>${String(markup)}</body>`, 'text/html');
}

function injectedElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('img, svg, iframe, script, [onerror], [onload]'));
}

describe('html tagged template', () => {
  it('keeps the literal markup and escapes an interpolated string', () => {
    const doc = parse(html`<b id="name">${PAYLOAD}</b>`);

    expect(doc.querySelector('b#name')?.textContent).toBe(PAYLOAD);
    expect(injectedElements(doc)).toEqual([]);
  });

  it('escapes quotes so a value cannot leave a quoted attribute', () => {
    const doc = parse(html`<a id="link" title="${'" onmouseover="alert(1)'}">x</a>`);
    const link = doc.querySelector('a#link');

    expect(link?.getAttribute('title')).toBe('" onmouseover="alert(1)');
    expect(link?.hasAttribute('onmouseover')).toBe(false);
  });

  it('passes a nested html value through without escaping it again', () => {
    const inner = html`<i>${'a & b'}</i>`;
    const outer = html`<p>${inner}</p>`;

    expect(String(outer)).toBe('<p><i>a &amp; b</i></p>');
  });

  it('passes a trustedHtml value through as markup', () => {
    expect(String(html`<div>${trustedHtml('<hr>')}</div>`)).toBe('<div><hr></div>');
  });

  it('joins arrays without separators, escaping each plain item', () => {
    const items = ['<one>', 'two'];
    // prettier-ignore
    const markup = html`<ul>${items.map((item) => html`<li>${item}</li>`)}${['<raw>']}</ul>`;

    expect(String(markup)).toBe('<ul><li>&lt;one&gt;</li><li>two</li>&lt;raw&gt;</ul>');
  });

  it('renders null, undefined and false as nothing and other values as escaped text', () => {
    expect(String(html`[${null}${undefined}${false}${0}${true}${42}]`)).toBe('[0true42]');
  });

  it('keeps the escape sequences of the literal parts', () => {
    // prettier-ignore
    const markup = html`<pre>a\nb</pre>`;

    expect(String(markup)).toBe('<pre>a\nb</pre>');
  });
});

describe('trustedHtml / isTrustedHtml', () => {
  it('wraps markup and returns it from toString and template literals', () => {
    const value = trustedHtml('<em>hi</em>');

    expect(isTrustedHtml(value)).toBe(true);
    expect(String(value)).toBe('<em>hi</em>');
    expect(`${value}`).toBe('<em>hi</em>');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(trustedHtml('<b></b>'))).toBe(true);
  });

  it.each([
    ['a plain string', '<b>x</b>'],
    ['null', null],
    ['a number', 1],
    ['an object with string keys that look like a brand', { html: '<b>x</b>', __trustedHtml: true }],
    ['a JSON round-trip of a trusted value', JSON.parse(JSON.stringify(trustedHtml('<b>x</b>')))],
  ])('does not treat %s as trusted', (_label, value) => {
    expect(isTrustedHtml(value)).toBe(false);
  });

  it('recognises a value branded by another copy of the module', () => {
    const foreign = { [Symbol.for('@frontmcp/uipack/trusted-html')]: '<b>x</b>', toString: () => '<b>x</b>' };

    expect(isTrustedHtml(foreign)).toBe(true);
  });
});

describe('template helpers', () => {
  it('expose html and trustedHtml that work when destructured', () => {
    const { html: tag, trustedHtml: trust } = createTemplateHelpers();

    expect(isTrustedHtml(tag`<b>${'<i>'}</b>`)).toBe(true);
    expect(String(tag`<b>${'<i>'}</b>`)).toBe('<b>&lt;i&gt;</b>');
    expect(String(trust('<i>ok</i>'))).toBe('<i>ok</i>');
  });
});
