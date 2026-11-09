/**
 * E2E Tests for a 'direct-url' widget route under auth modes that require a token
 *
 * A host loads the widget in a frame, which sends no credentials, so the route answers without a
 * token in every auth mode, while the MCP endpoint, its ui:// resource included, still requires one.
 */
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

const SERVER_COMMAND = 'npx tsx apps/e2e/demo-e2e-ui/src/main-auth.ts';

async function expectPublicWidgetRoute(server: TestServer): Promise<void> {
  const response = await fetch(`${server.info.baseUrl}/widgets/forecast`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toBe('frame-ancestors *');
  expect(await response.text()).toContain('forecast-widget');
}

async function expectProtectedMcpEndpoint(server: TestServer): Promise<void> {
  const response = await fetch(`${server.info.baseUrl}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain('Bearer');
}

describe("'direct-url' widget route under local auth (no anonymous access)", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: SERVER_COMMAND,
      project: 'demo-e2e-ui',
      env: { AUTH_MODE: 'local' },
      startupTimeout: 60000,
    });
  }, 90000);

  afterAll(async () => {
    await server?.stop();
  });

  it('serves the widget page without a token', async () => {
    await expectPublicWidgetRoute(server);
  });

  it('still requires a token for the MCP endpoint', async () => {
    await expectProtectedMcpEndpoint(server);
  });
});

describe("'direct-url' widget route under transparent auth", () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: oauthInfo.issuer, audience: oauthInfo.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    server = await TestServer.start({
      command: SERVER_COMMAND,
      project: 'demo-e2e-ui',
      env: {
        AUTH_MODE: 'transparent',
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
      },
      startupTimeout: 60000,
    });
  }, 90000);

  afterAll(async () => {
    await server?.stop();
    await mockOAuth?.stop();
  });

  it('serves the widget page without a token', async () => {
    await expectPublicWidgetRoute(server);
  });

  it('still requires a token for the MCP endpoint', async () => {
    await expectProtectedMcpEndpoint(server);
  });

  it('gives a caller with a token the ui:// resource that frames the route', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'user-1', scopes: ['read'] });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const resource = await client.resources.read('ui://widget/direct-url-forecast.html');

      expect(resource).toBeSuccessful();
      expect(resource.text()).toContain(`src="${server.info.baseUrl}/widgets/forecast"`);
    } finally {
      await client.disconnect();
    }
  });
});
