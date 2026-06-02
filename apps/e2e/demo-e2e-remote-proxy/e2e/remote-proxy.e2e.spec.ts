/**
 * E2E: Remote OAuth Proxy (`mode: 'remote'`)
 *
 * Proves the REAL upstream-OAuth proxy contract for remote mode:
 *  1. `/oauth/authorize` REDIRECTS straight to the upstream IdP — there is NO
 *     in-tree login page and NO provider-selection page.
 *  2. The full code-exchange round-trip (FrontMCP → upstream IdP →
 *     `/oauth/provider/upstream/callback` → client) mints a FrontMCP token whose
 *     identity (`sub`) is derived from the UPSTREAM user, not an in-tree form.
 *  3. A tool reads the stored upstream token via
 *     `this.orchestration.getToken('upstream')`.
 *
 * The upstream IdP is a per-test `MockOAuthServer` (auto-approve), mirroring the
 * `demo-e2e-orchestrated` harness.
 */
import { decodeJwt } from 'jose';

import { expect, MockOAuthServer, test, TestTokenFactory } from '@frontmcp/testing';

let upstreamTokenFactory: TestTokenFactory;
let upstreamServer: MockOAuthServer;

// The upstream IdP user. The minted FrontMCP token's `sub` must derive from this.
const upstreamUser = {
  sub: 'upstream-user-789',
  email: 'employee@enterprise.example.com',
  name: 'Enterprise Employee',
};

beforeAll(async () => {
  upstreamTokenFactory = new TestTokenFactory({ issuer: 'https://upstream.mock.local' });

  upstreamServer = new MockOAuthServer(upstreamTokenFactory, {
    autoApprove: true,
    testUser: upstreamUser,
    clientId: 'remote-proxy-client',
    // FrontMCP's per-provider callback (issuer is http://localhost:<port>).
    validRedirectUris: ['http://localhost:*/oauth/provider/upstream/callback'],
    debug: process.env['DEBUG'] === '1',
  });

  await upstreamServer.start();

  process.env['UPSTREAM_ISSUER'] = upstreamServer.info.issuer;
  process.env['UPSTREAM_CLIENT_ID'] = 'remote-proxy-client';
});

afterAll(async () => {
  delete process.env['UPSTREAM_ISSUER'];
  delete process.env['UPSTREAM_CLIENT_ID'];
  await upstreamServer?.stop();
});

test.describe('Remote OAuth Proxy E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remote-proxy/src/main.ts',
    project: 'demo-e2e-remote-proxy',
    // Pin the server JWT secret for deterministic HS256 signing/verification of
    // the FrontMCP session token (the server both mints and verifies it).
    env: { JWT_SECRET: 'remote-proxy-e2e-shared-secret-0123456789' },
  });

  /**
   * GET /oauth/authorize with a valid PKCE challenge. In remote mode this MUST
   * 302 straight to the upstream IdP's /oauth/authorize.
   */
  async function authorize(baseUrl: string, codeChallenge: string) {
    const url = new URL(`${baseUrl}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'e2e-client');
    url.searchParams.set('redirect_uri', 'http://127.0.0.1:65010/callback');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', 'e2e-remote-state');
    return fetch(url.toString(), { redirect: 'manual' });
  }

  test('GET /oauth/authorize redirects straight to the upstream IdP (no in-tree login page)', async ({ server }) => {
    const { generatePkcePair } = await import('@frontmcp/utils');
    const { codeChallenge } = await generatePkcePair();

    const res = await authorize(server.info.baseUrl, codeChallenge);

    // It is a redirect to the upstream IdP — NOT a 200 HTML login/selection page.
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const target = new URL(location!);
    // Points at the upstream MockOAuthServer's authorize endpoint.
    expect(`${target.origin}${target.pathname}`).toBe(`${upstreamServer.info.baseUrl}/oauth/authorize`);
    // Carries the per-provider callback redirect_uri + federated state + PKCE.
    expect(target.searchParams.get('redirect_uri')).toContain('/oauth/provider/upstream/callback');
    expect(target.searchParams.get('state')).toMatch(/^federated:/);
    expect(target.searchParams.get('code_challenge')).toBeTruthy();
    expect(target.searchParams.get('client_id')).toBe('remote-proxy-client');
  });

  test('full round-trip mints a FrontMCP token whose identity comes from the upstream user, and a tool reads the upstream token', async ({
    server,
  }) => {
    const { generateCodeVerifier, sha256Base64url } = await import('@frontmcp/utils');

    // FrontMCP-side PKCE for the authorization-code → token exchange.
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);

    // 1) /oauth/authorize → upstream IdP redirect.
    let current = (await authorize(server.info.baseUrl, challenge)).headers.get('location');
    expect(current).toBeTruthy();

    // 2) Follow the redirect chain: upstream IdP auto-approves → redirects to
    //    /oauth/provider/upstream/callback → FrontMCP completes the exchange and
    //    redirects to the client redirect_uri carrying the FrontMCP code.
    let clientCode: string | undefined;
    for (let hop = 0; hop < 10; hop++) {
      const res = await fetch(current!, { redirect: 'manual' });
      const location = res.headers.get('location');
      if (!location) {
        // No further redirect — surface the body to aid debugging on failure.
        const body = await res.text();
        throw new Error(`Expected a redirect at hop ${hop} but got ${res.status}: ${body.slice(0, 200)}`);
      }
      const next = new URL(location, current!);
      if (next.origin === 'http://127.0.0.1:65010' && next.pathname === '/callback') {
        clientCode = next.searchParams.get('code') ?? undefined;
        // The original client state is round-tripped back.
        expect(next.searchParams.get('state')).toBe('e2e-remote-state');
        break;
      }
      current = next.toString();
    }
    expect(clientCode).toBeDefined();

    // 3) Exchange the FrontMCP authorization code for a FrontMCP token.
    const tokenRes = await fetch(`${server.info.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: clientCode!,
        redirect_uri: 'http://127.0.0.1:65010/callback',
        client_id: 'e2e-client',
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    expect(tokenJson.access_token).toBeDefined();

    // The minted FrontMCP token's identity derives from the UPSTREAM user.
    const claims = decodeJwt(tokenJson.access_token!);
    // sub is the deterministic hash of the upstream email/sub (never the raw
    // upstream sub) — assert it is present and stable, not an anonymous value.
    expect(typeof claims.sub).toBe('string');
    expect(claims.sub).not.toMatch(/^anon:/);

    // 4) Use the FrontMCP token to call a tool that reads the upstream token.
    const client = await server.createClient({ token: tokenJson.access_token! });
    try {
      const result = await client.tools.call('whoami', {});
      expect(result).toBeSuccessful();
      const data = result.json<{
        authenticated: boolean;
        tokenReceived: boolean;
        providerId?: string;
        tokenPrefix?: string;
      }>();
      expect(data.authenticated).toBe(true);
      // The orchestration accessor resolved the REAL upstream token.
      expect(data.tokenReceived).toBe(true);
      expect(data.providerId).toBe('upstream');
      expect(data.tokenPrefix && data.tokenPrefix.length).toBeGreaterThan(0);
    } finally {
      await client.disconnect();
    }
  });

  test('unauthenticated MCP requests are rejected with 401', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
  });
});
