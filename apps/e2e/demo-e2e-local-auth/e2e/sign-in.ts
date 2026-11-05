import { expect } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { browserFetch } from './browser-fetch';

export interface ApiKeySignIn {
  clientId: string;
  redirectUri: string;
  apiKey: string;
}

/** Signs in with the login page's `apiKey` field, as a browser and an OAuth client do, and returns the access token. */
export async function signInWithApiKey(baseUrl: string, signIn: ApiKeySignIn): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: signIn.clientId,
    redirect_uri: signIn.redirectUri,
    code_challenge: sha256Base64url(codeVerifier),
    code_challenge_method: 'S256',
    scope: 'read write',
  }).toString();
  const loginPage = await browserFetch(authorizeUrl.toString(), { method: 'GET', redirect: 'manual' });
  expect(loginPage.status).toBe(200);
  const pendingAuthId = (await loginPage.text()).match(/name="pending_auth_id"\s+value="([^"]+)"/)?.[1] ?? '';
  expect(pendingAuthId).not.toBe('');

  const callbackUrl = new URL(`${baseUrl}/oauth/callback`);
  callbackUrl.search = new URLSearchParams({ pending_auth_id: pendingAuthId, apiKey: signIn.apiKey }).toString();
  const callback = await browserFetch(callbackUrl.toString(), { method: 'GET', redirect: 'manual' });
  expect([302, 303]).toContain(callback.status);
  const code = new URL(callback.headers.get('location') ?? baseUrl).searchParams.get('code') ?? '';

  const tokenResponse = await browserFetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: signIn.redirectUri,
      client_id: signIn.clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });
  expect(tokenResponse.status).toBe(200);
  const tokenBody = (await tokenResponse.json()) as { access_token: string };
  return tokenBody.access_token;
}
