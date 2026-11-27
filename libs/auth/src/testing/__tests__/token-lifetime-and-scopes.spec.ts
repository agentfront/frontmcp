/**
 * Issue #644 — access tokens minted by MockOAuthServer carry the granted `scope`, their `exp` follows
 * `accessTokenTtlSeconds` (not only `expires_in`), and `expiresIn: 1` cannot expire before first use.
 */
import { MockOAuthServer } from '../mock-oauth-server';
import { TestTokenFactory } from '../token-factory';

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('TestTokenFactory lifetime', () => {
  const factory = new TestTokenFactory();

  it('a one second token is valid for at least one full second', async () => {
    const before = Date.now();
    const payload = decodePayload(await factory.createTestToken({ sub: 'u', exp: 1 }));
    const exp = payload['exp'] as number;
    expect(exp * 1000).toBeGreaterThanOrEqual(before + 1000);
    expect(Number.isInteger(payload['iat'])).toBe(true);
  });

  it('defaults to one hour', async () => {
    const payload = decodePayload(await factory.createTestToken({ sub: 'u' }));
    const lifetime = (payload['exp'] as number) - (payload['iat'] as number);
    expect(lifetime).toBeGreaterThanOrEqual(3600);
    expect(lifetime).toBeLessThanOrEqual(3601);
  });

  it('createAnonymousToken honours the requested lifetime', async () => {
    const payload = decodePayload(await factory.createAnonymousToken(30));
    const lifetime = (payload['exp'] as number) - (payload['iat'] as number);
    expect(lifetime).toBeGreaterThanOrEqual(30);
    expect(lifetime).toBeLessThanOrEqual(31);
    expect(payload['scope']).toBe('anonymous');
  });
});

describe('MockOAuthServer token claims', () => {
  const factory = new TestTokenFactory();
  let server: MockOAuthServer;

  beforeAll(async () => {
    server = new MockOAuthServer(factory, {
      autoApprove: true,
      testUser: { sub: 'scoped-user', email: 'scoped@example.com', name: 'Scoped' },
      clientId: 'test-client',
      validRedirectUris: ['http://localhost:3000/callback'],
      accessTokenTtlSeconds: 120,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  async function exchange(scope: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', 'test-client');
    authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', scope);
    const auth = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
    const code = new URL(auth.headers.get('location') as string).searchParams.get('code') as string;
    const res = await fetch(`${server.info.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: 'test-client',
      }).toString(),
    });
    return res.json();
  }

  it('puts the granted scopes into the access token and honours the ttl in exp', async () => {
    const tokens = await exchange('read write');
    const payload = decodePayload(tokens.access_token);
    expect(payload['scope']).toBe('read write');
    expect((payload['exp'] as number) - (payload['iat'] as number)).toBeGreaterThanOrEqual(120);
    expect((payload['exp'] as number) - (payload['iat'] as number)).toBeLessThanOrEqual(121);
    expect(tokens.expires_in).toBe(120);
  });

  it('keeps the scopes and ttl on refreshed access tokens', async () => {
    const tokens = await exchange('read');
    const res = await fetch(`${server.info.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: 'test-client',
      }).toString(),
    });
    const refreshed = (await res.json()) as { access_token: string };
    const payload = decodePayload(refreshed.access_token);
    expect(payload['scope']).toBe('read');
    expect((payload['exp'] as number) - (payload['iat'] as number)).toBeGreaterThanOrEqual(120);
  });
});
