/**
 * A structured template result is shown as indented JSON, unless it is nested so deeply that the
 * indentation would make the page grow with the square of the value's size.
 */
import { renderToolTemplate } from '../template-renderer';

function renderResult(output: unknown): string {
  return renderToolTemplate({
    toolName: 'echo',
    input: {},
    output,
    template: (ctx: { output: unknown }) => ctx.output,
  }).html;
}

describe('structured template results', () => {
  it('are indented', () => {
    expect(renderResult({ order: { id: 7, items: [1] } })).toContain(
      '<pre>{\n  &quot;order&quot;: {\n    &quot;id&quot;: 7,\n    &quot;items&quot;: [\n      1\n    ]\n  }\n}</pre>',
    );
  });

  it('are written compact when nested 5,000 levels deep', () => {
    const nested = JSON.parse(`${'['.repeat(5000)}${']'.repeat(5000)}`);

    const html = renderResult(nested);

    expect(html.length).toBeLessThan(200_000);
    expect(html).toContain(`<pre>${'['.repeat(5000)}${']'.repeat(5000)}</pre>`);
  });

  it('count brackets inside strings as text, not nesting', () => {
    expect(renderResult({ text: '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[' })).toContain(
      '<pre>{\n  &quot;text&quot;: &quot;[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[&quot;\n}</pre>',
    );
  });
});
