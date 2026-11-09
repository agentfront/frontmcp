/**
 * `ui.uiType`: each value forces its renderer, and a template the renderer can't take is refused.
 */

import { trustedHtml } from '../../shell/trusted-html';
import { requireFromProject } from '../project-require';
import { describeRenderOptionProblems } from '../render-options';
import { renderToolTemplate, type RenderToolTemplateOptions } from '../template-renderer';

// The React the renderer loads from the project, so these components and it share one copy
const react = requireFromProject<{
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  memo(component: unknown): unknown;
  useState<T>(initial: T): [T, (value: T) => void];
  Component: new (props: unknown) => { props: Record<string, unknown> };
}>('react', 'the spec');

type WidgetProps = { output: { city: string } | null; input: { units?: string } | null; loading: boolean };

function Weather({ output, input, loading }: WidgetProps) {
  const [unit] = react.useState(input?.units ?? 'C');
  return react.createElement(
    'p',
    { className: 'weather' },
    loading || !output ? 'Loading' : `${output.city} in ${unit}`,
  );
}

function render(template: unknown, extra: Partial<RenderToolTemplateOptions> = {}) {
  const result = renderToolTemplate({
    toolName: 'weather',
    input: { units: 'F' },
    output: { city: 'Oslo' },
    template,
    logger: { warn: jest.fn() },
    ...extra,
  });
  return { ...result, body: /<body[^>]*>([\s\S]*)<\/body>/.exec(result.html)?.[1].trim() ?? '' };
}

describe("uiType: 'react'", () => {
  it('renders a component reference on the server with the widget props, hooks included', () => {
    const result = render(Weather, { uiType: 'react' });
    expect(result.body).toBe('<p class="weather">Oslo in F</p>');
    expect(result.uiType).toBe('react');
  });

  it('renders the loading state for a widget compiled without a call', () => {
    expect(render(Weather, { uiType: 'react', input: undefined, output: undefined }).body).toBe(
      '<p class="weather">Loading</p>',
    );
  });

  it('renders memo and class components', () => {
    expect(render(react.memo(Weather), { uiType: 'react' }).body).toBe('<p class="weather">Oslo in F</p>');
    class Card extends react.Component {
      render() {
        return react.createElement('div', null, (this.props['output'] as { city: string }).city);
      }
    }
    expect(render(Card, { uiType: 'react' }).body).toBe('<div>Oslo</div>');
  });

  it('escapes the data it renders', () => {
    expect(render(Weather, { uiType: 'react', output: { city: '<img src=x onerror=alert(1)>' } }).body).toContain(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('does not warn about a component reference it renders', () => {
    const warn = jest.fn();
    render(Weather, { uiType: 'react', logger: { warn } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a component reference without uiType the empty page it was, pointing at uiType', () => {
    const warn = jest.fn();
    function Unforced() {
      return react.createElement('p', null, 'x');
    }
    expect(render(Unforced, { logger: { warn } }).body).toBe('<div id="root"></div>');
    expect(warn.mock.calls[0][0]).toContain("set `ui.uiType: 'react'` to render it on the server");
  });
});

describe("uiType: 'html' and 'markdown'", () => {
  it("uses a string as HTML with 'html', even without < and >", () => {
    expect(render('# not a heading', { uiType: 'html' }).body).toBe('# not a heading');
  });

  it("calls a capitalized function as an HTML builder with 'html'", () => {
    function Card() {
      return trustedHtml('<section>card</section>');
    }
    expect(render(Card, { uiType: 'html' }).body).toBe('<section>card</section>');
  });

  it("converts a string from Markdown with 'markdown', escaping its HTML", () => {
    expect(render('# Title\n\n<b>raw</b>', { uiType: 'markdown' }).body).toBe(
      '<h1>Title</h1>\n<p>&lt;b&gt;raw&lt;/b&gt;</p>',
    );
  });

  it("converts a function's string result from Markdown with 'markdown', with the markdown options", () => {
    const warn = jest.fn();
    const result = render((ctx: { output: { city: string } }) => `## ${ctx.output.city}\n\n~~<i>x</i>~~`, {
      uiType: 'markdown',
      markdown: { gfm: true },
      logger: { warn },
    });
    expect(result.body).toBe('<h2>Oslo</h2>\n<p><del>&lt;i&gt;x&lt;/i&gt;</del></p>');
    expect(result.uiType).toBe('markdown');
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps trusted markup from a function as HTML with 'markdown'", () => {
    expect(render(() => trustedHtml('<em>ok</em>'), { uiType: 'markdown' }).body).toBe('<em>ok</em>');
  });
});

describe("uiType: 'mdx'", () => {
  it('renders a string as MDX without components', () => {
    expect(render('# {output.city}', { uiType: 'mdx' }).body).toBe('<h1>Oslo</h1>');
  });
});

describe('uiType checks', () => {
  const file = { file: './widget.tsx' };
  it.each([
    ['react', 'a string', '# x', "`ui.uiType: 'react'` renders a React component"],
    ['react', 'a { file } that is not .tsx', { file: './w.html' }, 'a `{ file }` that is not a .tsx or .jsx file'],
    [
      'mdx',
      'a function',
      () => 'x',
      "`ui.uiType: 'mdx'` renders an MDX template, which is a string, and this template is a function.",
    ],
    [
      'html',
      'a { file } widget',
      file,
      "`ui.uiType: 'html'` renders a string or a template function, and this template is a `{ file }` widget.",
    ],
    ['markdown', 'a React class', class extends react.Component {}, 'and this template is a React component.'],
  ] as const)("refuses '%s' on %s", (uiType, _name, template, message) => {
    expect(describeRenderOptionProblems(template, { uiType })).toEqual([expect.stringContaining(message)]);
  });

  it.each([
    ['react', Weather],
    ['react', file],
    ['html', () => 'x'],
    ['markdown', '# x'],
    ['mdx', '# x'],
    ['auto', file],
  ] as const)("accepts '%s'", (uiType, template) => {
    expect(describeRenderOptionProblems(template, { uiType })).toEqual([]);
  });

  it('refuses mdxComponents with a uiType other than mdx', () => {
    expect(describeRenderOptionProblems('# x', { uiType: 'markdown', mdxComponents: {} })).toEqual([
      "`ui.mdxComponents` is for an MDX template, and `ui.uiType` is 'markdown'.",
    ]);
  });

  it('reports the forced type in the result meta', () => {
    expect(render('<p>x</p>', { uiType: 'markdown' }).meta['ui/type']).toBe('markdown');
  });
});
