/**
 * The pages of widgets that set none of the rendering options (`contentSecurity`, `runtimeOptions`,
 * `mdxComponents`, `uiType`, `hydrate`), recorded before those options were built. A change here
 * changes what every existing widget sends.
 */

import { html as markup, trustedHtml } from '../../shell/trusted-html';
import { renderToolTemplate, type RenderToolTemplateOptions } from '../template-renderer';

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => 'export default function Widget({ output }) {\n  return <div>{output?.city}</div>;\n}\n'),
  existsSync: jest.fn(() => true),
}));

jest.mock('../../component/ui-availability', () => ({
  isFrontmcpUiResolvable: jest.fn(() => true),
}));

jest.mock('esbuild', () => ({
  buildSync: jest.fn(() => ({ outputFiles: [{ text: 'console.log("bundled widget");' }] })),
}));

const quietLogger = { warn: jest.fn() };

/** FNV-1a over the page, so a snapshot pins every byte without storing the bridge script each time. */
function digest(page: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < page.length; i++) {
    hash ^= page.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function pageRecord(page: string): { length: number; digest: string; body: string } {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1] ?? page;
  return { length: page.length, digest: digest(page), body };
}

function render(template: unknown, extra: Partial<RenderToolTemplateOptions> = {}): ReturnType<typeof pageRecord> {
  return pageRecord(
    renderToolTemplate({
      toolName: 'weather',
      input: { city: 'Oslo' },
      output: { city: 'Oslo', tempC: 21, note: '<b>warm</b>' },
      template,
      logger: quietLogger,
      ...extra,
    }).html,
  );
}

function Weather() {
  return null;
}

describe('pages of widgets without rendering options', () => {
  it.each([
    [
      'an HTML string',
      '<div class="card"><h2>Weather</h2><button onclick="go()">Go</button><script>init()</script></div>',
    ],
    [
      'a Markdown string',
      '# Weather\n\nToday is **sunny**, see [the forecast](https://example.com) and `code`.\n\n- one\n- two',
    ],
    ['a Markdown string with a table', '| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~ www.example.com\n\n- [x] done'],
    ['a Markdown string with fenced code', '```ts\nconst x = 1 < 2;\n```'],
  ])('renders %s as before', (_name, template) => {
    expect(render(template)).toMatchSnapshot();
  });

  it('renders a template function built with html as before', () => {
    expect(
      render(
        (ctx: { output: { city: string; note: string } }) =>
          markup`<h2>${ctx.output.city}</h2><p onclick="x()">${ctx.output.note}</p><a href="javascript:void(0)">x</a>`,
      ),
    ).toMatchSnapshot();
  });

  it('renders trusted markup with scripts and handlers as before', () => {
    expect(
      render(() => trustedHtml('<div onmouseover="hover()"><script>document.title = "x"</script></div>')),
    ).toMatchSnapshot();
  });

  it('renders a plain string result as before, escaped and unescaped', () => {
    const template = () => '<em>markup</em>';
    expect(render(template)).toMatchSnapshot();
    expect(render(template, { escapeStringResults: false })).toMatchSnapshot();
  });

  it('renders a JSON result as before', () => {
    expect(render(() => ({ rows: [1, 2] }) as unknown as string)).toMatchSnapshot();
  });

  it('renders a capitalized HTML builder as before', () => {
    expect(
      render(function Card() {
        return '<div>card</div>';
      }),
    ).toMatchSnapshot();
  });

  it('renders a component reference as the empty page it was', () => {
    expect(render(Weather)).toMatchSnapshot();
  });

  it('feeds esbuild the same widget code for a .tsx file, in both resource modes', () => {
    const esbuild = jest.requireMock('esbuild') as { buildSync: jest.Mock };
    for (const resourceMode of ['cdn', 'inline'] as const) {
      esbuild.buildSync.mockClear();
      const page = render({ file: '/app/weather.widget.tsx' }, { resourceMode });
      const [buildOptions] = esbuild.buildSync.mock.calls[0];
      expect({
        page,
        stdin: buildOptions.stdin.contents,
        external: buildOptions.external,
        jsx: buildOptions.jsx,
        platform: buildOptions.platform,
      }).toMatchSnapshot(resourceMode);
    }
  });
});
