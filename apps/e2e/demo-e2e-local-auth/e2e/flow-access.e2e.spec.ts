/**
 * `@Flow({ access })` over Express in local mode: an `'authorized'` flow on its own route answers 401 until
 * `session:verify` accepts a token the server signed, and then runs for that caller. A `'public'` flow answers anyone.
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { browserFetch } from './browser-fetch';

const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'flow-access-client';

async function signIn(baseUrl: string): Promise<string> {
  const verifier = generateCodeVerifier();
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: sha256Base64url(verifier),
    code_challenge_method: 'S256',
  }).toString();
  const loginPage = await browserFetch(authorizeUrl.toString(), { redirect: 'manual' });
  const pendingAuthId = (await loginPage.text()).match(/name="pending_auth_id"\s+value="([^"]+)"/)?.[1] ?? '';

  const callbackUrl = new URL(`${baseUrl}/oauth/callback`);
  callbackUrl.searchParams.set('pending_auth_id', pendingAuthId);
  const callback = await browserFetch(callbackUrl.toString(), { redirect: 'manual' });
  const code = new URL(callback.headers.get('location') ?? baseUrl).searchParams.get('code') ?? '';

  const tokenResponse = await browserFetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  return ((await tokenResponse.json()) as { access_token: string }).access_token;
}

describe('@Flow({ access }) in local mode', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-local-auth/src/main.ts',
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
    });
  }, 90000);

  afterAll(async () => {
    await server?.stop();
  });

  const get = (path: string, token?: string) =>
    browserFetch(`${server.info.baseUrl}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

  it('answers a public flow without a token', async () => {
    const response = await get('/flow-access/public');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: null });
  });

  it('answers 401 with the challenge for an authorized flow without a token, and for a public route that runs one', async () => {
    const response = await get('/flow-access/authorized');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect((await get('/flow-access/runs-caller')).status).toBe(401);
  });

  it('runs an authorized flow for a caller signed in with a token the server signed', async () => {
    const token = await signIn(server.info.baseUrl);

    const direct = await get('/flow-access/authorized', token);
    const nested = await get('/flow-access/runs-caller', token);

    expect(direct.status).toBe(200);
    const { sub } = (await direct.json()) as { sub: string };
    expect(sub).toEqual(expect.any(String));
    expect(sub).not.toMatch(/^anon:/);
    expect(nested.status).toBe(200);
    expect(await nested.json()).toEqual({ sub });
  });
});
