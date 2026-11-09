/**
 * `@Flow({ access })` over Express in transparent mode: an `'authorized'` flow on its own route answers 401 with the
 * challenge until `session:verify` accepts the request's token, and a flow a public route runs is checked against that
 * route's caller. A `'public'` flow answers anyone.
 */
import { expect, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('@Flow({ access }) in transparent mode', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    const probe = new MockOAuthServer(new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' }));
    const { port, issuer } = await probe.start();
    await probe.stop();

    tokenFactory = new TestTokenFactory({ issuer, audience: issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { port });
    const oauthInfo = await mockOAuth.start();

    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-transparent/src/main.ts',
      env: { IDP_PROVIDER_URL: oauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: oauthInfo.issuer },
      startupTimeout: 30000,
    });
  }, 60000);

  afterAll(async () => {
    await server?.stop();
    await mockOAuth?.stop();
  });

  const get = (path: string, token?: string) =>
    fetch(`${server.info.baseUrl}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

  it('answers a public flow without a token', async () => {
    const response = await get('/flow-access/public');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: null });
  });

  it('answers 401 with the challenge for an authorized flow without a token', async () => {
    const response = await get('/flow-access/authorized');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('answers 401 for a token with an invalid signature', async () => {
    const forged = tokenFactory.createTokenWithInvalidSignature({ sub: 'mallory' });

    expect((await get('/flow-access/authorized', forged)).status).toBe(401);
  });

  it('runs an authorized flow for a verified caller', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'flow-user' });
    const response = await get('/flow-access/authorized', token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: 'flow-user' });
  });

  it("checks an authorized flow a public route runs against the route's caller", async () => {
    const token = await tokenFactory.createTestToken({ sub: 'flow-user' });

    expect((await get('/flow-access/runs-caller')).status).toBe(401);
    const verified = await get('/flow-access/runs-caller', token);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ sub: 'flow-user' });
  });
});
