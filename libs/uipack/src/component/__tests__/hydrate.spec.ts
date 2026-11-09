/**
 * `ui.hydrate`: a `{ file }` widget is rendered on the server into `#root`, and its mount hydrates
 * that markup with the props the server rendered it with. Bundles a real widget with esbuild.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { describeRenderOptionProblems } from '../../adapters/render-options';
import { renderToolTemplate } from '../../adapters/template-renderer';

const WIDGET = `import { useState } from 'react';

export default function Counter({ output, input, loading }: {
  output: { label: string; start: number } | null;
  input: { step?: number } | null;
  loading: boolean;
}) {
  const [count] = useState(output?.start ?? 0);
  if (loading || !output) return <p className="loading">Loading</p>;
  return <div className="counter" data-step={input?.step}>{output.label}: {count}</div>;
}

export function Named() {
  return <span>named</span>;
}
`;

describe('hydrate', () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(__dirname, 'hydrate-widget-'));
    file = join(dir, 'counter.widget.tsx');
    writeFileSync(file, WIDGET);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function page(extra: Record<string, unknown> = {}) {
    return renderToolTemplate({
      toolName: 'counter',
      input: { step: 2 },
      output: { label: 'Clicks <b>', start: 3 },
      template: { file },
      hydrate: true,
      ...extra,
    }).html;
  }

  it('renders the widget into #root with the call data, escaped', () => {
    expect(page()).toContain(
      '<div id="root"><div class="counter" data-step="2">Clicks &lt;b&gt;<!-- -->: <!-- -->3</div></div>',
    );
  });

  it('hydrates in the page with the props the server rendered with', () => {
    const html = page({ resourceMode: 'inline' });
    expect(html).toMatch(/__reactRoot = \(0, import_client\.hydrateRoot\)\(\s*__root,/);
    expect(html).toContain('__initial = window.__mcpToolOutput !== null ? window.__mcpToolOutput : void 0;');
    expect(html).not.toMatch(/createRoot\)\(__root\)/);
  });

  it('renders the loading state for a widget compiled without a call', () => {
    expect(page({ input: undefined, output: undefined })).toContain(
      '<div id="root"><p class="loading">Loading</p></div>',
    );
  });

  it('renders the named export the template names', () => {
    expect(
      renderToolTemplate({
        toolName: 'n',
        input: {},
        output: {},
        template: { file, exportName: 'Named' },
        hydrate: true,
      }).html,
    ).toContain('<div id="root"><span>named</span></div>');
  });

  it('leaves #root empty and mounts with createRoot without hydrate', () => {
    const html = renderToolTemplate({ toolName: 'counter', input: {}, output: {}, template: { file } }).html;
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('hydrateRoot');
  });

  it('refuses hydrate on a template that is not a { file } React widget', () => {
    function Widget() {
      return null;
    }
    expect(describeRenderOptionProblems(Widget, { hydrate: true })).toEqual([
      expect.stringContaining(
        "`ui.hydrate` needs the component's code in the page, and a component reference has no source file",
      ),
    ]);
    expect(describeRenderOptionProblems('<p>x</p>', { hydrate: true })).toEqual([
      expect.stringContaining(
        '`ui.hydrate` hydrates a React widget rendered on the server, a `{ file }` .tsx or .jsx widget, and this template is an HTML string.',
      ),
    ]);
    expect(describeRenderOptionProblems('# x', { hydrate: true, mdxComponents: {} })).toEqual([
      expect.stringContaining('this template is an MDX template, which renders to static HTML.'),
    ]);
    expect(describeRenderOptionProblems({ file }, { hydrate: true })).toEqual([]);
  });
});
