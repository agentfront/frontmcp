import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { createTestJwtIssuer, TEST_CLIENT_INFO } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../common';
import { MetricsPathConflictError } from '../../metrics/metrics.errors';
import { FrontMcpInstance } from '../front-mcp';

function namedTool(name: string) {
  @Tool({ name, inputSchema: {} })
  class NamedTool extends ToolContext {
    async execute() {
      return { tool: name };
    }
  }
  return NamedTool;
}

@App({ id: 'billing', name: 'Billing', tools: [namedTool('charge')] })
class BillingApp {}

@App({ id: 'support', name: 'Support', tools: [namedTool('open_ticket')] })
class SupportApp {}

@App({ id: 'console', name: 'Console', standalone: true, tools: [namedTool('inspect')] })
class ConsoleApp {}

@App({ id: 'metrics', name: 'Metrics', tools: [namedTool('report')] })
class MetricsApp {}

function toolsListAt(handler: (request: Request) => Promise<Response>, path: string): Promise<Response> {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: TEST_CLIENT_INFO,
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
}

async function toolNamesAt(handler: (request: Request) => Promise<Response>, path: string): Promise<string[]> {
  const response = await toolsListAt(handler, path);
  const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
  return (body.result?.tools ?? []).map((tool) => tool.name).sort();
}

describe('createFetchHandler() with several scopes', () => {
  it('serves every app of a splitByApp server at its own path', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-fetch', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      splitByApp: true,
      logging: { level: LogLevel.Off },
    });

    await expect(toolNamesAt(handler, '/billing')).resolves.toEqual(['charge']);
    await expect(toolNamesAt(handler, '/support')).resolves.toEqual(['open_ticket']);
  });

  it.each(['/', '/elsewhere'])(
    'answers %s of a splitByApp server with a 404 that lists every endpoint, as the Node server answers it',
    async (path) => {
      const handler = await FrontMcpInstance.createFetchHandler({
        info: { name: 'split-fetch-root', version: '1.0.0' },
        apps: [BillingApp, SupportApp],
        splitByApp: true,
        logging: { level: LogLevel.Off },
      });

      const response = await toolsListAt(handler, path);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not Found', entryPaths: ['/billing', '/support'] });
    },
  );

  it("serves a splitByApp server's only app at its own path, not at the entry path", async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-fetch-one', version: '1.0.0' },
      apps: [BillingApp],
      splitByApp: true,
      http: { entryPath: '/mcp' },
      logging: { level: LogLevel.Off },
    });

    await expect(toolNamesAt(handler, '/mcp/billing')).resolves.toEqual(['charge']);
    expect((await toolsListAt(handler, '/mcp')).status).toBe(404);
  });

  it('serves a standalone app at its own path, next to the server', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'standalone-fetch', version: '1.0.0' },
      apps: [BillingApp, ConsoleApp],
      logging: { level: LogLevel.Off },
    });

    await expect(toolNamesAt(handler, '/')).resolves.toEqual(['charge']);
    await expect(toolNamesAt(handler, '/console')).resolves.toEqual(['inspect']);
  });

  it.each(['billing', 'support'])('serves the protected resource metadata %s names in its challenge', async (appId) => {
    const issuer = await createTestJwtIssuer();
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-fetch-auth', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      splitByApp: true,
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      logging: { level: LogLevel.Off },
    });

    const challenge = await handler(
      new Request(`http://localhost/${appId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    const header = challenge.headers.get('www-authenticate') ?? '';
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
    expect(challenge.status).toBe(401);
    expect(metadataUrl).toBeDefined();

    const metadata = await handler(new Request(metadataUrl as string));
    expect(metadata.status).toBe(200);
    const body = (await metadata.json()) as { resource?: string };
    expect(body.resource).toBe(`http://localhost/${appId}`);
  });

  it('refuses a metrics path that a splitByApp app is served at', async () => {
    const creating = FrontMcpInstance.createFetchHandler({
      info: { name: 'split-fetch-metrics', version: '1.0.0' },
      apps: [BillingApp, MetricsApp],
      splitByApp: true,
      metrics: { enabled: true },
      logging: { level: LogLevel.Off },
    });

    await expect(creating).rejects.toBeInstanceOf(MetricsPathConflictError);
  });
});
