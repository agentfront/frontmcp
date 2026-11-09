/**
 * E2E: a CIMD client whose document declares `token_endpoint_auth_method: 'private_key_jwt'` signs in, then
 * authenticates every token request with a client assertion signed by a key from its `jwks_uri` (RFC 7523).
 */
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

import { expect, MockCimdServer, test } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const REDIRECT_URI = 'http://localhost:3000/callback';

let cimdServer: MockCimdServer;
let privateKey: CryptoKey;

test.describe('CIMD private_key_jwt E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-cimd/src/main.ts',
    project: 'demo-e2e-cimd',
  });

  test.beforeAll(async () => {
    cimdServer = new MockCimdServer({ debug: false });
    await cimdServer.start();
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'e2e-1', alg: 'ES256', use: 'sig' };
    cimdServer.registerInvalidDocument('/keys/jwks.json', { keys: [publicJwk] });
  });

  test.afterAll(async () => {
    await cimdServer?.stop();
  });

  function registerKeyClient(name: string): string {
    return cimdServer.registerClient({
      name,
      redirectUris: [REDIRECT_URI],
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwksUri: `${cimdServer.info.baseUrl}/keys/jwks.json`,
    });
  }

  function clientAssertion(clientId: string, tokenEndpoint: string): Promise<string> {
    return new SignJWT({ jti: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'ES256', kid: 'e2e-1' })
      .setIssuer(clientId)
      .setSubject(clientId)
      .setAudience(tokenEndpoint)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);
  }

  async function authorizationCode(baseUrl: string, clientId: string, codeVerifier: string): Promise<string> {
    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: sha256Base64url(codeVerifier),
      code_challenge_method: 'S256',
      state: 'e2e',
    }).toString();
    const loginPage = await fetch(authorizeUrl, { redirect: 'manual' });
    expect(loginPage.status).toBe(200);
    const pendingAuthId = (await loginPage.text()).match(/name="pending_auth_id"\s+value="([^"]+)"/)?.[1] ?? '';
    const cookie = loginPage.headers
      .getSetCookie()
      .map((setCookie) => setCookie.split(';')[0])
      .join('; ');

    const callbackUrl = new URL(`${baseUrl}/oauth/callback`);
    callbackUrl.search = new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'e2e@example.com' }).toString();
    const callback = await fetch(callbackUrl, { redirect: 'manual', headers: { cookie } });
    expect([302, 303]).toContain(callback.status);
    return new URL(callback.headers.get('location') ?? baseUrl).searchParams.get('code') ?? '';
  }

  async function tokenRequest(baseUrl: string, form: Record<string, string>) {
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  test('exchanges the code and refreshes with assertions signed by a key from jwks_uri', async ({ server }) => {
    const baseUrl = server.info.baseUrl;
    const tokenEndpoint = `${baseUrl}/oauth/token`;
    const clientId = registerKeyClient('signed-desk');
    const codeVerifier = generateCodeVerifier();
    const code = await authorizationCode(baseUrl, clientId, codeVerifier);

    const issued = await tokenRequest(baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: await clientAssertion(clientId, tokenEndpoint),
    });
    expect(issued.status).toBe(200);

    const refreshed = await tokenRequest(baseUrl, {
      grant_type: 'refresh_token',
      refresh_token: String(issued.body['refresh_token']),
      client_id: clientId,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: await clientAssertion(clientId, tokenEndpoint),
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body['access_token']).toEqual(expect.any(String));
  });

  test('refuses a code exchange without a client assertion', async ({ server }) => {
    const baseUrl = server.info.baseUrl;
    const clientId = registerKeyClient('unsigned-desk');
    const codeVerifier = generateCodeVerifier();
    const code = await authorizationCode(baseUrl, clientId, codeVerifier);

    const refused = await tokenRequest(baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: clientId,
    });

    expect(refused.status).toBe(400);
    expect(refused.body['error']).toBe('invalid_client');
  });

  test('advertises private_key_jwt in the authorization server metadata', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`);
    const metadata = (await response.json()) as Record<string, unknown>;

    expect(metadata['token_endpoint_auth_methods_supported']).toContain('private_key_jwt');
    expect(metadata['token_endpoint_auth_signing_alg_values_supported']).toContain('ES256');
  });
});
