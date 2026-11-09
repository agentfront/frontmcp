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

  test('mdxComponents renders an MDX template on the server, with the call data in its expressions', async ({
    server,
  }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('mdx-interactive', {
        topic: 'Caching <b>tips</b>',
        points: ['Measure first', 'Expire {wisely}'],
        codeExample: 'cache.set(key, value)',
      });
      expect(result).toBeSuccessful();
      expect(result.raw._meta?.['ui/type']).toBe('mdx');

      const markup = body(String(result.raw._meta?.['ui/html']));
      expect(markup).toContain('<h1>Caching &lt;b&gt;tips&lt;/b&gt;</h1>');
      expect(markup).toContain('<div class="alert alert-info"');
      expect(markup).toContain('This is an interactive MDX document with 2 key points.');
      expect(markup).toContain('<div class="highlight-box"');
      expect(markup).toContain('<li>Measure first</li><li>Expire {wisely}</li>');
      expect(markup).toContain('<code>cache.set(key, value)</code>');
    } finally {
      await client.disconnect();
    }
  });

  test("uiType: 'react' renders a component reference on the server", async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('status-card', { service: '<api>' });
      expect(result).toBeSuccessful();
      expect(result.raw._meta?.['ui/type']).toBe('react');
      expect(body(String(result.raw._meta?.['ui/html']))).toContain(
        '<div class="status-card status-up"><strong>&lt;api&gt;</strong> is up</div>',
      );
    } finally {
      await client.disconnect();
    }
  });

  test('hydrate renders a { file } widget on the server and hydrates it in the page', async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('hydrated-counter', { label: 'Clicks', start: 3 });
      expect(result).toBeSuccessful();
      const html = String(result.raw._meta?.['ui/html']);
      expect(html).toMatch(
        /<div id="root"><div class="counter"><span>Clicks<!-- -->: <!-- -->3<\/span><button type="button">\+1<\/button><\/div><\/div>/,
      );
      expect(html).toMatch(/\.hydrateRoot\)\(\s*__root,/);
    } finally {
      await client.disconnect();
    }
  });
});
