/**
 * E2E Tests for ui.htmlResponsePrefix (the dual payload)
 *
 * A Claude client that declares no MCP Apps support renders no widget, so it gets the page as a
 * second text block in an html code fence. Clients that render widgets get the result as before.
 */
import { expect, test } from '@frontmcp/testing';

type Content = Array<{ type: string; text: string }>;

test.describe('Dual payload E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test('a Claude client gets the JSON, then the prefixed page with the call’s data', async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('dual-payload-weather', { city: 'Lisbon' });
      const [json, page] = result.raw.content as Content;

      expect(result).toBeSuccessful();
      expect(JSON.parse(json.text)).toEqual({ city: 'Lisbon', temperature: 21 });
      expect(page.text).toMatch(/^Here is the weather dashboard:\n\n```html\n<!DOCTYPE html>/);
      expect(page.text).toContain('<div id="dual-weather">Lisbon: 21</div>');
    } finally {
      await client.disconnect();
    }
  });

  test('an MCP Apps host and ChatGPT get one text block, as without the option', async ({ server }) => {
    const host = await server
      .createClientBuilder()
      .withTransport('streamable-http')
      .withPlatform('ext-apps')
      .buildAndConnect();
    const chatgpt = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'ChatGPT', version: '1.0.0' },
    });
    try {
      for (const client of [host, chatgpt]) {
        const result = await client.tools.call('dual-payload-weather', { city: 'Porto' });
        expect(result).toBeSuccessful();
        expect(result.raw.content).toHaveLength(1);
      }
    } finally {
      await host.disconnect();
      await chatgpt.disconnect();
    }
  });
});
