/**
 * `ui.contentSecurity`: the markup a template builds on the server is sanitized when it is set, and
 * used as written when it is not.
 */

import { html, trustedHtml } from '../../shell/trusted-html';
import { describeRenderOptionProblems } from '../render-options';
import { renderToolTemplate, type RenderToolTemplateOptions } from '../template-renderer';

const MARKUP = '<div onclick="go()"><script>init()</script><a href="javascript:alert(1)">x</a><b>ok</b></div>';

function body(template: unknown, extra: Partial<RenderToolTemplateOptions> = {}): string {
  const page = renderToolTemplate({
    toolName: 'report',
    input: {},
    output: { summary: MARKUP },
    template,
    logger: { warn: jest.fn() },
    ...extra,
  }).html;
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1] ?? '';
}

describe('contentSecurity', () => {
  it.each([
    ['an HTML string', MARKUP, {}],
    ['trusted markup', () => trustedHtml(MARKUP), {}],
    [
      'a string result rendered as markup',
      (ctx: { output: { summary: string } }) => ctx.output.summary,
      { escapeStringResults: false },
    ],
  ])('sanitizes %s when set', (_name, template, extra) => {
    const sanitized = body(template, { ...extra, contentSecurity: {} });
    expect(sanitized).toContain('<div><a>x</a><b>ok</b></div>');
    expect(sanitized).not.toMatch(/onclick|init\(\)|javascript:/);
  });

  it.each([
    ['an HTML string', MARKUP, {}],
    ['trusted markup', () => trustedHtml(MARKUP), {}],
    [
      'a string result rendered as markup',
      (ctx: { output: { summary: string } }) => ctx.output.summary,
      { escapeStringResults: false },
    ],
  ])('leaves %s as written when unset', (_name, template, extra) => {
    expect(body(template, extra)).toContain(MARKUP);
  });

  it('sanitizes the HTML a Markdown string converts to', () => {
    expect(body('# Report\n\n[x](https://example.com)', { contentSecurity: {} })).toContain(
      '<h1>Report</h1>\n<p><a href="https://example.com" rel="noopener noreferrer">x</a></p>',
    );
  });

  it('keeps escaped values escaped', () => {
    const sanitized = body((ctx: { output: { summary: string } }) => html`<p>${ctx.output.summary}</p>`, {
      contentSecurity: {},
    });
    expect(sanitized).toContain('&lt;script&gt;init()&lt;/script&gt;');
  });

  it('relaxes with its flags', () => {
    expect(body(MARKUP, { contentSecurity: { allowInlineScripts: true } })).toContain(
      '<div onclick="go()"><script>init()</script><a>x</a><b>ok</b></div>',
    );
    expect(body(MARKUP, { contentSecurity: { allowUnsafeLinks: true } })).toContain(
      '<div><a href="javascript:alert(1)">x</a><b>ok</b></div>',
    );
    expect(body(MARKUP, { contentSecurity: { bypassSanitization: true } })).toContain(MARKUP);
  });

  it('leaves the page around the markup alone', () => {
    const page = renderToolTemplate({
      toolName: 'report',
      input: {},
      output: {},
      template: '<p>x</p>',
      contentSecurity: {},
    }).html;
    expect(page).toContain('window.__mcpToolName');
    expect(page).toContain('FrontMcpBridge');
  });

  it('cannot be set on a { file } widget, which renders in the page', () => {
    expect(describeRenderOptionProblems({ file: './widget.tsx' }, { contentSecurity: {} })).toEqual([
      expect.stringContaining('`ui.contentSecurity` sanitizes the markup FrontMCP builds on the server'),
    ]);
    expect(() =>
      renderToolTemplate({
        toolName: 'w',
        input: {},
        output: {},
        template: { file: './widget.tsx' },
        contentSecurity: {},
      }),
    ).toThrow('Tool "w": `ui.contentSecurity`');
    expect(describeRenderOptionProblems({ file: './widget.tsx' }, {})).toEqual([]);
    expect(describeRenderOptionProblems('<p>x</p>', { contentSecurity: {} })).toEqual([]);
  });

  it('refuses a policy that is not an object of boolean flags, which a truthy string would otherwise switch off', () => {
    expect(describeRenderOptionProblems('<p>x</p>', { contentSecurity: 'false' as never })).toEqual([
      '`ui.contentSecurity` must be an object of flags, and it is string "false".',
    ]);
    expect(() =>
      renderToolTemplate({
        toolName: 'w',
        input: {},
        output: {},
        template: MARKUP,
        contentSecurity: { allowInlineScripts: 'no' } as never,
      }),
    ).toThrow('`ui.contentSecurity.allowInlineScripts` must be true or false');
  });

  it('fails the render of markup over maxMarkupLength rather than send it unsanitized', () => {
    expect(() =>
      renderToolTemplate({
        toolName: 'w',
        input: {},
        output: {},
        template: MARKUP,
        contentSecurity: { maxMarkupLength: 10 },
      }),
    ).toThrow(RangeError);
  });
});
