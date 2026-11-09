/**
 * E2E Tests for URL-served widgets
 *
 * `servingMode: 'direct-url'` serves the page compiled at startup on a route of the server, and
 * `'custom-url'` loads the page at `customWidgetUrl`. Either way the widget's ui:// resource is a page
 * that frames that URL and declares its origin as a frame.
 */
import { expect, test } from '@frontmcp/testing';

type ResourceContent = { text?: string; _meta?: Record<string, Record<string, unknown>> };

test.describe('URL-served widgets E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test.describe("servingMode: 'direct-url'", () => {
    test('serves the page compiled at startup on its route, which any host may frame', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/widgets/forecast`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('content-security-policy')).toBe('frame-ancestors *');
      expect(response.headers.get('x-frame-options')).toBeNull();
      const page = await response.text();
      expect(page).toContain('forecast-widget');
      expect(page).toContain('window.__mcpToolOutput = null;');
    });

    test('sends ChatGPT the data only, no page', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });
      try {
        const result = await client.tools.call('direct-url-forecast', { city: 'Lisbon' });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        expect(result.raw.structuredContent).toEqual({ city: 'Lisbon', high: 24 });
      } finally {
        await client.disconnect();
      }
    });

    test('sends an MCP Apps host the data only, no page', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();
      try {
        const result = await client.tools.call('direct-url-forecast', { city: 'Porto' });

        expect(result).toBeSuccessful();
        expect(result.raw._meta?.['ui/html']).toBeUndefined();
        expect(result.raw.structuredContent).toEqual({ city: 'Porto', high: 24 });
      } finally {
        await client.disconnect();
      }
    });

    for (const platform of ['ChatGPT', 'ext-apps'] as const) {
      test(`gives ${platform} a ui:// resource that frames the route and allows its origin`, async ({ server }) => {
        const client =
          platform === 'ChatGPT'
            ? await server.createClient({
                transport: 'streamable-http',
                clientInfo: { name: 'ChatGPT', version: '1.0.0' },
              })
            : await server
                .createClientBuilder()
                .withTransport('streamable-http')
                .withPlatform('ext-apps')
                .buildAndConnect();
        try {
          const resource = await client.resources.read('ui://widget/direct-url-forecast.html');
          const content = resource.raw.contents[0] as ResourceContent;
          const origin = new URL(server.info.baseUrl).origin;

          expect(resource).toBeSuccessful();
          expect(resource.hasMimeType('text/html;profile=mcp-app')).toBe(true);
          expect(content.text).toContain(`<iframe id="frontmcp-widget" src="${server.info.baseUrl}/widgets/forecast"`);
          expect(content.text).not.toContain('forecast-widget');
          expect(content._meta?.['ui']?.['csp']).toEqual(
            expect.objectContaining({ connectDomains: ['https://api.forecast.example'], frameDomains: [origin] }),
          );
          expect(content._meta?.['openai/widgetCSP']).toEqual({
            connect_domains: ['https://api.forecast.example'],
            resource_domains: [],
            frame_domains: [origin],
          });
        } finally {
          await client.disconnect();
        }
      });
    }

    test('still points tools/list at the ui:// resource', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });
      try {
        const tool = (await client.tools.list()).find((candidate) => candidate.name === 'direct-url-forecast');
        expect((tool?._meta?.['ui'] as Record<string, unknown>)?.['resourceUri']).toBe(
          'ui://widget/direct-url-forecast.html',
        );
      } finally {
        await client.disconnect();
      }
    });
  });

  test.describe("servingMode: 'custom-url'", () => {
    test('sends the data only, no page', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();
      try {
        const result = await client.tools.call('custom-url-forecast', { city: 'Faro' });

        expect(result).toBeSuccessful();
        expect(result.raw._meta?.['ui/html']).toBeUndefined();
        expect(result.raw.structuredContent).toEqual({ city: 'Faro', low: 12 });
      } finally {
        await client.disconnect();
      }
    });

    test('gives a ui:// resource that frames the URL and allows its origin', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });
      try {
        const resource = await client.resources.read('ui://widget/custom-url-forecast.html');
        const content = resource.raw.contents[0] as ResourceContent;

        expect(resource).toBeSuccessful();
        expect(content.text).toContain('src="https://widgets.forecast.example/low.html"');
        expect(content._meta?.['ui']?.['csp']).toEqual(
          expect.objectContaining({ frameDomains: ['https://widgets.forecast.example'] }),
        );
        expect(content._meta?.['openai/widgetCSP']).toEqual(
          expect.objectContaining({ frame_domains: ['https://widgets.forecast.example'] }),
        );
      } finally {
        await client.disconnect();
      }
    });
  });
});
