/**
 * @jest-environment jsdom
 */
/**
 * String results of template functions and the `escapeStringResults` opt-in (#601).
 *
 * A template that returns a plain string, such as `(ctx) => ctx.output`, has that string rendered
 * as HTML, so untrusted tool output returned unescaped injects markup. `escapeStringResults: true`
 * escapes plain strings; markup built with `ctx.helpers.html` or wrapped with
 * `ctx.helpers.trustedHtml` still renders. With the option unset the behaviour is unchanged and a
 * one-time notice per tool points at the new API.
 */
import type { TemplateHelpers } from '../../shell/data-injector';
import { trustedHtml } from '../../shell/trusted-html';
import { renderToolTemplate, type RenderToolTemplateOptions } from '../index';

const PAYLOAD = '<img src=x onerror=alert(1)>';

type Ctx = { input: unknown; output: unknown; helpers: TemplateHelpers };

let toolCounter = 0;

function uniqueToolName(): string {
  return `string_results_tool_${++toolCounter}`;
}

function render(
  template: (ctx: Ctx) => unknown,
  options: Partial<RenderToolTemplateOptions> = {},
): { doc: Document; warn: jest.Mock } {
  const warn = jest.fn();
  const { html } = renderToolTemplate({
    toolName: uniqueToolName(),
    input: {},
    output: PAYLOAD,
    template,
    logger: { warn },
    ...options,
  });
  return { doc: new DOMParser().parseFromString(html, 'text/html'), warn };
}

function injectedElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('body img, body [onerror], body [onload]'));
}

describe('template string results — escapeStringResults: true', () => {
  it('escapes a plain string returned by the template', () => {
    const { doc } = render((ctx) => ctx.output, { escapeStringResults: true });

    expect(injectedElements(doc)).toEqual([]);
    expect(doc.body.textContent).toContain(PAYLOAD);
  });

  it('escapes a markup string assembled with a plain template literal', () => {
    const { doc } = render((ctx) => `<b>${String(ctx.output)}</b>`, { escapeStringResults: true });

    expect(doc.querySelector('body b')).toBeNull();
    expect(injectedElements(doc)).toEqual([]);
  });

  it('keeps the markup of an html`` result and escapes the interpolated output', () => {
    const { doc } = render((ctx) => ctx.helpers.html`<b id="out">${ctx.output}</b>`, { escapeStringResults: true });

    expect(doc.querySelector('b#out')?.textContent).toBe(PAYLOAD);
    expect(injectedElements(doc)).toEqual([]);
  });

  it('does not escape nested html`` values twice', () => {
    const { doc } = render(
      (ctx) =>
        ctx.helpers.html`<ul id="list">${['a & b', PAYLOAD].map((item) => ctx.helpers.html`<li>${item}</li>`)}</ul>`,
      { escapeStringResults: true },
    );

    const items = Array.from(doc.querySelectorAll('ul#list > li')).map((li) => li.textContent);
    expect(items).toEqual(['a & b', PAYLOAD]);
    expect(injectedElements(doc)).toEqual([]);
  });

  it('renders a trustedHtml result as markup', () => {
    const { doc } = render((ctx) => ctx.helpers.trustedHtml('<section id="trusted"><b>ok</b></section>'), {
      escapeStringResults: true,
    });

    expect(doc.querySelector('section#trusted b')?.textContent).toBe('ok');
  });

  it('renders a trusted value created outside the helpers as markup', () => {
    const { doc } = render(() => trustedHtml('<p id="standalone">ok</p>'), { escapeStringResults: true });

    expect(doc.querySelector('p#standalone')).not.toBeNull();
  });

  it('keeps chart, mermaid and object results on their own escaped paths', () => {
    const mermaid = render(() => 'graph TD; A-->B', { escapeStringResults: true }).doc;
    const object = render(() => ({ title: PAYLOAD }), { escapeStringResults: true }).doc;

    expect(mermaid.querySelector('pre.mermaid')?.textContent).toBe('graph TD; A-->B');
    expect(JSON.parse(object.querySelector('body pre')?.textContent ?? '')).toEqual({ title: PAYLOAD });
    expect(injectedElements(object)).toEqual([]);
  });

  it('does not log the migration notice', () => {
    const { warn } = render((ctx) => ctx.output, { escapeStringResults: true });

    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a static string template (not a function result) as markup', () => {
    const { doc } = render(() => '', { template: '<div id="static-template"></div>', escapeStringResults: true });

    expect(doc.querySelector('div#static-template')).not.toBeNull();
  });
});

describe('template string results — option unset (default, unchanged in 1.8)', () => {
  it('still renders a plain markup string as HTML', () => {
    const { doc } = render((ctx) => ctx.output);

    expect(doc.querySelector('body img')).not.toBeNull();
  });

  it('logs the migration notice once per tool', () => {
    const toolName = uniqueToolName();
    const warn = jest.fn();
    const options: RenderToolTemplateOptions = {
      toolName,
      input: {},
      output: '<b>x</b>',
      template: (ctx: Ctx) => ctx.output,
      logger: { warn },
    };

    renderToolTemplate(options);
    renderToolTemplate(options);
    renderToolTemplate(options);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(toolName);
    expect(message).toContain('html`');
    expect(message).toContain('escapeStringResults');
    expect(message).toContain('1.9');
  });

  it('logs the notice again for a different tool', () => {
    const first = render((ctx) => ctx.output);
    const second = render((ctx) => ctx.output);

    expect(first.warn).toHaveBeenCalledTimes(1);
    expect(second.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to console.warn when no logger is given', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      renderToolTemplate({
        toolName: uniqueToolName(),
        input: {},
        output: '<b>x</b>',
        template: (ctx: Ctx) => ctx.output,
      });

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['an html`` result', (ctx: Ctx) => ctx.helpers.html`<b>${ctx.output}</b>`],
    ['a trustedHtml result', (ctx: Ctx) => ctx.helpers.trustedHtml('<b>ok</b>')],
    ['plain text without markup', () => 'Temperature: 18 degrees'],
    ['an object result', () => ({ ok: true })],
  ])('does not log the notice for %s', (_label, template) => {
    const { warn } = render(template);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not log the notice when the option is explicitly false', () => {
    const { doc, warn } = render((ctx) => ctx.output, { escapeStringResults: false });

    expect(doc.querySelector('body img')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
