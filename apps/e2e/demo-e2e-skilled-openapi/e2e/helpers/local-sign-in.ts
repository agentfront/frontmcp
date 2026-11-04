import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const CLIENT_ID = 'skilled-openapi-e2e';
const REDIRECT_URI = 'http://127.0.0.1:9877/callback';

/** The `name=value` pairs a response sets, as a `cookie` header: the sign-in's binding cookie. */
function cookiesSetBy(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ');
}

/** Signs in to a local-mode server with the login `fields`, as a browser would, and returns the access token. */
export async function signIn(baseUrl: string, fields: Record<string, string>): Promise<string> {
  const verifier = generateCodeVerifier();
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: sha256Base64url(verifier),
    code_challenge_method: 'S256',
  }).toString();
  const loginPage = await fetch(authorizeUrl, { redirect: 'manual' });
  const pendingAuthId = (await loginPage.text()).match(/name="pending_auth_id"\s+value="([^"]+)"/)?.[1];
  if (!pendingAuthId) throw new Error(`the login page (${loginPage.status}) has no pending_auth_id`);

  const callbackUrl = new URL(`${baseUrl}/oauth/callback`);
  callbackUrl.search = new URLSearchParams({ pending_auth_id: pendingAuthId, ...fields }).toString();
  const callback = await fetch(callbackUrl, { redirect: 'manual', headers: { cookie: cookiesSetBy(loginPage) } });
  const code = new URL(callback.headers.get('location') ?? '', baseUrl).searchParams.get('code');
  if (!code) throw new Error(`the login callback (${callback.status}) issued no authorization code`);

  const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!accessToken) throw new Error(`the token endpoint (${tokenResponse.status}) issued no access token`);
  return accessToken;
}
