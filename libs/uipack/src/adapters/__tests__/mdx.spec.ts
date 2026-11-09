/**
 * MDX templates: a string template with `mdxComponents` is compiled with @mdx-js/mdx and rendered on
 * the server with React; its expressions read the call's data as values, never as source.
 */

import { compileMdxTemplate, renderMdxTemplate } from '../mdx';
import { requireFromProject } from '../project-require';
import { describeRenderOptionProblems, prepareRenderOptions } from '../render-options';
import { renderToolTemplate } from '../template-renderer';

// The React the renderer loads from the project, so these components and it share one copy
const react = requireFromProject<{
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
}>('react', 'the spec');

const Alert = ({ type, children }: { type?: string; children?: unknown }) =>
  react.createElement('div', { className: `alert alert-${type ?? 'info'}` }, children);

const TEMPLATE = '# {output.title}\n\n<Alert type="warning">{output.count} open, **{input.team}**</Alert>';

function body(template: unknown, extra: Record<string, unknown> = {}): string {
  const page = renderToolTemplate({
    toolName: 'board',
    input: { team: 'core' },
    output: { title: 'Issues', count: 3 },
    template,
    mdxComponents: { Alert },
    ...extra,
  }).html;
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1].trim() ?? '';
}

describe('MDX templates', () => {
  it('renders the template with its components and the call data', () => {
    expect(body(TEMPLATE)).toBe(
      '<h1>Issues</h1>\n<div class="alert alert-warning">3 open, <strong>core</strong></div>',
    );
  });

  it('reports the template as mdx', () => {
    const result = renderToolTemplate({
      toolName: 'b',
      input: {},
      output: {},
      template: TEMPLATE,
      mdxComponents: { Alert },
    });
    expect(result.uiType).toBe('mdx');
    expect(result.meta['ui/type']).toBe('mdx');
  });

  it('escapes the data it renders, which never becomes markup or code', () => {
    const markup = body('<Alert>{output.title}</Alert>', {
      output: { title: '<img src=x onerror=alert(1)>{process.exit(1)}' },
    });
    expect(markup).toBe('<div class="alert alert-info">&lt;img src=x onerror=alert(1)&gt;{process.exit(1)}</div>');
  });

  it('renders the template compiled at startup without a call', () => {
    expect(body('# {output.title ?? "Waiting"}', { input: undefined, output: undefined })).toBe('<h1>Waiting</h1>');
  });

  it('lets mdxComponents replace HTML elements', () => {
    const h1 = ({ children }: { children?: unknown }) => react.createElement('h1', { className: 'title' }, children);
    expect(body('# Hi', { mdxComponents: { h1 } })).toBe('<h1 class="title">Hi</h1>');
  });

  it('applies gfm and highlightTheme from runtimeOptions.markdown', () => {
    const markup = body('| a |\n|---|\n| ~~1~~ |\n\n```ts\nconst x = 1;\n```', {
      markdown: { gfm: true, highlightTheme: 'github' },
    });
    expect(markup).toMatch(/^<style>[^<]*\.hljs/);
    expect(markup).toContain('<td><del>1</del></td>');
    expect(markup).toContain(
      '<code class="hljs language-ts"><span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;\n</code>',
    );
    expect(body('| a |\n|---|\n| 1 |')).not.toContain('<table>');
  });

  it('is sanitized like other markup when contentSecurity is set', () => {
    const Link = () => react.createElement('a', { href: 'javascript:alert(1)' }, 'x');
    expect(body('<Link />', { mdxComponents: { Link }, contentSecurity: {} })).not.toContain('javascript:');
  });

  it('compiles each template once', () => {
    expect(compileMdxTemplate('# once {output.n}')).toBe(compileMdxTemplate('# once {output.n}'));
    expect(compileMdxTemplate('# once {output.n}', true)).not.toBe(compileMdxTemplate('# once {output.n}'));
  });

  it('refuses an import, which an inline template has no module to resolve from', () => {
    expect(() => compileMdxTemplate("import x from 'fs'\n\n# x")).toThrow();
  });

  it('names a component the template uses and mdxComponents lacks', () => {
    expect(() => renderMdxTemplate('<Missing />', { input: {}, output: {}, helpers: {} })).toThrow(/Missing/);
  });
});

describe('MDX template checks', () => {
  it.each([
    ['a function', () => '# x', 'a function'],
    ['a { file } widget', { file: './w.tsx' }, 'a `{ file }` widget'],
  ])('refuses mdxComponents on %s', (_name, template, described) => {
    expect(describeRenderOptionProblems(template, { mdxComponents: { Alert } })).toEqual([
      expect.stringContaining(
        `\`ui.mdxComponents\` is for an MDX template, which is a string, and this template is ${described}.`,
      ),
    ]);
  });

  it('takes runtimeOptions.markdown on an MDX template', () => {
    expect(describeRenderOptionProblems('<Alert />', { mdxComponents: { Alert }, markdown: { gfm: true } })).toEqual(
      [],
    );
  });

  it('compiles the template at startup, so a syntax error fails before any call', async () => {
    await expect(prepareRenderOptions('<Alert', { mdxComponents: { Alert } })).rejects.toThrow();
    await expect(prepareRenderOptions(TEMPLATE, { mdxComponents: { Alert } })).resolves.toBeUndefined();
  });
});
