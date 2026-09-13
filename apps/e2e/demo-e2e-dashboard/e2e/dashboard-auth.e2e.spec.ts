/**
 * E2E regression guard for GHSA-rgxj-434m-vxh3 — the dashboard's configured
 * authentication token was never enforced.
 *
 * The plugin documents `auth: { enabled: true, token: '…' }` and the option is
 * schema-validated, so an operator has every reason to believe the dashboard is
 * protected. Three defects made it public anyway:
 *
 *   1. the middleware never read `options.auth`;
 *   2. `DashboardHttpPlugin.init({})` hard-coded empty options, so the
 *      operator's config could not have reached the middleware even if it had;
 *   3. the dashboard's own MCP scope declared `auth: { mode: 'public' }`, and
 *      its introspection tools reach the ROOT scope — so `dashboard:graph`
 *      returned the whole server's inventory to an anonymous caller.
 *
 * The server under test configures the token exactly as the docs show.
 */
import { expect, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-dashboard/src/main.ts';
const TOKEN = 'test-dashboard-token';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dashboard-auth-e2e', version: '1.0' },
    },
  });
}

describe('Dashboard authentication (GHSA-rgxj-434m-vxh3)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-dashboard',
      startupTimeout: 60_000,
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90_000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  describe('the dashboard page', () => {
    it('refuses an unauthenticated request', async () => {
      const res = await fetch(`${baseUrl}/dashboard`);

      expect(res.status).toBe(401);
    });

    it('refuses a wrong token', async () => {
      const res = await fetch(`${baseUrl}/dashboard?token=not-the-token`);

      expect(res.status).toBe(401);
    });

    it('serves the page for the configured token as a query parameter', async () => {
      const res = await fetch(`${baseUrl}/dashboard?token=${TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    it('serves the page for the configured token as a bearer header', async () => {
      // Preferred over the query form: a URL token lands in access logs,
      // Referer headers and browser history.
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });

      expect(res.status).toBe(200);
    });

    it('does not leak the configured token into the served HTML', async () => {
      const res = await fetch(`${baseUrl}/dashboard?token=${TOKEN}`);
      const html = await res.text();

      expect(html).not.toContain(TOKEN);
    });
  });

  describe('the dashboard MCP scope on a PUBLIC server', () => {
    it('is exactly as open as the server itself — no more, no less', async () => {
      // The dashboard used to declare `auth: { mode: 'public' }` regardless of
      // the server's policy. It now inherits, so on a public server the
      // dashboard's introspection is public too — the same exposure as the
      // server's own `tools/list`, not an extra one. The authenticated case
      // below is where the fix bites.
      const res = await fetch(`${baseUrl}/dashboard`, {
        method: 'POST',
        headers: MCP_HEADERS,
        body: initializeBody(),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('the rest of the server', () => {
    it('still serves the main MCP endpoint (dashboard auth is scoped to the dashboard)', async () => {
      const res = await fetch(baseUrl, { method: 'POST', headers: MCP_HEADERS, body: initializeBody() });

      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeTruthy();
    });
  });
});

describe('Dashboard MCP scope inherits server auth (GHSA-rgxj-434m-vxh3)', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let authServer: TestServer;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const probe = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: probe.issuer, audience: probe.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: probe.port });
    const final = await mockOAuth.start();

    authServer = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-dashboard/src/main.authenticated.ts',
      project: 'demo-e2e-dashboard',
      env: { IDP_PROVIDER_URL: final.baseUrl, IDP_EXPECTED_AUDIENCE: final.issuer },
      startupTimeout: 60_000,
      debug: process.env['DEBUG'] === '1',
    });
  }, 90_000);

  afterAll(async () => {
    if (authServer) await authServer.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  it('refuses an anonymous initialize on the dashboard scope', async () => {
    const res = await fetch(`${authServer.info.baseUrl}/dashboard`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: initializeBody(),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('does not expose the server inventory to an anonymous caller', async () => {
    const res = await fetch(`${authServer.info.baseUrl}/dashboard`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'dashboard:graph', arguments: {} },
      }),
    });

    // MCP-over-HTTP answers a sessionless call with 200 + a JSON-RPC error, so
    // the HTTP status proves nothing here. Assert the envelope IS an error (not
    // merely that the body lacks the tool name, which an unrelated 5xx would
    // also satisfy) AND that no inventory leaked.
    const body = (await res.json()) as { error?: { code: number }; result?: unknown };

    expect(body.error).toBeDefined();
    expect(body.result).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('read-secret');
  });

  it('serves the dashboard scope to an authenticated caller', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'operator', claims: {} });
    const res = await fetch(`${authServer.info.baseUrl}/dashboard`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${token}` },
      body: initializeBody(),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});
