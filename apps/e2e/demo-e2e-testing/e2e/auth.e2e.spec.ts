/**
 * E2E for `mcp.authenticate()`, token scopes and expiry against a real server (issue #644).
 */
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('authentication against a transparent-mode server', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // The issuer URL embeds the port, so it is only known once the mock OAuth server is listening.
    // Probe a free port, then rebind it; if another process grabs it in between, probe again.
    let oauthInfo: Awaited<ReturnType<MockOAuthServer['start']>> | undefined;
    for (let attempt = 0; attempt < 5 && !oauthInfo; attempt++) {
      const probe = new MockOAuthServer(new TestTokenFactory(), { debug: false });
      const probeInfo = await probe.start();
      await probe.stop();

      tokenFactory = new TestTokenFactory({ issuer: probeInfo.issuer, audience: probeInfo.issuer });
      mockOAuth = new MockOAuthServer(tokenFactory, {
        debug: false,
        port: probeInfo.port,
        autoApprove: true,
        testUser: { sub: 'oauth-user', email: 'oauth@example.com', name: 'OAuth User' },
        clientId: 'test-client',
        validRedirectUris: ['http://localhost:3000/callback'],
      });
      try {
        oauthInfo = await mockOAuth.start();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      }
    }
    if (!oauthInfo) throw new Error('Could not bind a port for the mock OAuth server');

    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-testing/src/main.transparent.ts',
      project: 'demo-e2e-testing',
      env: { IDP_PROVIDER_URL: oauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: oauthInfo.issuer },
      startupTimeout: 30000,
    });
  }, 90000);

  afterAll(async () => {
    await server?.stop();
    await mockOAuth?.stop();
  });

  it('tools see the scopes carried by the token', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'scoped-user', scopes: ['read', 'write'] });
    const client = await McpTestClient.create({ baseUrl: server.info.baseUrl, auth: { token } }).buildAndConnect();
    try {
      const me = (await client.tools.call('whoami', {})).json<{ sub: string; scopes: string[] }>();
      expect(me.sub).toBe('scoped-user');
      expect(me.scopes).toEqual(expect.arrayContaining(['read', 'write']));
    } finally {
      await client.disconnect();
    }
  });

  it('authenticate() rejects a token the server refuses and keeps the previous identity', async () => {
    const first = await tokenFactory.createTestToken({ sub: 'first-user', scopes: ['read'] });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      auth: { token: first },
    }).buildAndConnect();
    try {
      const forged = await new TestTokenFactory({ issuer: 'https://evil.example' }).createTestToken({ sub: 'evil' });
      await expect(client.authenticate(forged)).rejects.toThrow();
      expect(client.isConnected()).toBe(true);
      expect((await client.tools.call('whoami', {})).json<{ sub: string }>().sub).toBe('first-user');

      const second = await tokenFactory.createTestToken({ sub: 'second-user', scopes: ['write'] });
      await client.authenticate(second);
      const me = (await client.tools.call('whoami', {})).json<{ sub: string; scopes: string[] }>();
      expect(me.sub).toBe('second-user');
      expect(me.scopes).toContain('write');
    } finally {
      await client.disconnect();
    }
  });

  it('a token with an expiry of one second is still accepted on first use', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'short-lived', exp: 1 });
    const client = await McpTestClient.create({ baseUrl: server.info.baseUrl, auth: { token } }).buildAndConnect();
    expect(client.isConnected()).toBe(true);
    await client.disconnect();
  });

  it('an expired token is rejected', async () => {
    const token = await tokenFactory.createExpiredToken({ sub: 'expired' });
    await expect(
      McpTestClient.create({ baseUrl: server.info.baseUrl, auth: { token } }).buildAndConnect(),
    ).rejects.toThrow();
  });

  it('access tokens from the mock OAuth server carry the granted scope', async () => {
    const authorize = new URL(`${mockOAuth.info.baseUrl}/oauth/authorize`);
    authorize.searchParams.set('client_id', 'test-client');
    authorize.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'read write');
    const redirect = await fetch(authorize.toString(), { redirect: 'manual' });
    const code = new URL(redirect.headers.get('location') as string).searchParams.get('code') as string;
    const tokenRes = await fetch(`${mockOAuth.info.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: 'test-client',
      }).toString(),
    });
    const tokens = (await tokenRes.json()) as { access_token: string };
    const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.scope).toBe('read write');
  });
});
