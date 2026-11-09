/**
 * E2E: the `ui` rendering options, as a widget host receives the page.
 */
import { expect, test } from '@frontmcp/testing';

function body(html: string): string {
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
}

test.describe('Tool UI rendering options E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test('contentSecurity removes scripts, handlers and unsafe links from the widget markup', async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('sanitized-summary', {
        summaryHtml:
          '<h2 onclick="steal()">Q3</h2><script>steal()</script><a href="javascript:steal()">open</a>' +
          '<a href="https://example.com/q3">report</a><img src=x onerror=steal()>',
      });
      expect(result).toBeSuccessful();

      const markup = body(String(result.raw._meta?.['ui/html']));
      expect(markup).toContain(
        '<section class="summary"><h2>Q3</h2><a>open</a><a href="https://example.com/q3">report</a><img src="x"></section>',
      );
      expect(markup).not.toContain('steal()');
    } finally {
      await client.disconnect();
    }
  });

  test('runtimeOptions.markdown converts GitHub-flavored Markdown and highlights code in the widget resource', async ({
    server,
  }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'ChatGPT', version: '1.0.0' },
    });
    try {
      const read = await client.resources.read('ui://widget/markdown-table.html');
      const markup = body(read.text() ?? '');

      expect(markup).toContain('<th align="left">Region</th><th align="right">Sales</th>');
      expect(markup).toContain('<input type="checkbox" disabled checked> Collect');
      expect(markup).toContain('<del>Guess</del> Review');
      expect(markup).toContain('<code class="hljs language-ts"><span class="hljs-keyword">const</span>');
      expect(markup).toMatch(/<style>[^<]*\.hljs/);
    } finally {
      await client.disconnect();
    }
  });
});
