/**
 * E2E Tests for ui.bundlingMode
 *
 * Where servingMode is unset ('auto'), bundlingMode decides when the page is built: 'static' once at
 * startup, for every platform, and 'dynamic' with each call's data, ChatGPT included.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('bundlingMode E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test("'static': an MCP Apps host gets no page with the call, and the resource is the page built at startup", async ({
    server,
  }) => {
    const client = await server
      .createClientBuilder()
      .withTransport('streamable-http')
      .withPlatform('ext-apps')
      .buildAndConnect();
    try {
      const result = await client.tools.call('bundled-static-note', { text: 'hello' });
      expect(result).toBeSuccessful();
      expect(result.raw._meta?.['ui/html']).toBeUndefined();

      const resource = await client.resources.read('ui://widget/bundled-static-note.html');
      expect(resource.text()).toContain('<div id="static-note">note</div>');
      expect(resource.text()).toContain('window.__mcpToolOutput = null;');
    } finally {
      await client.disconnect();
    }
  });

  test("'dynamic': ChatGPT gets the page rendered with the call's data", async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'ChatGPT', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('bundled-dynamic-note', { text: 'hello' });
      expect(result).toBeSuccessful();
      expect(result.raw._meta?.['ui/html']).toContain('<div id="dynamic-note">hello</div>');
    } finally {
      await client.disconnect();
    }
  });
});
