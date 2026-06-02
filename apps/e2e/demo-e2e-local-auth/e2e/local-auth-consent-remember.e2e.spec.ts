/**
 * E2E Tests for FrontMCP LOCAL-mode auth with CONSENT MODE + rememberConsent.
 *
 * Drives the OAuth 2.1 authorization-code + PKCE flow over real HTTP against a
 * `auth.consent.rememberConsent: true` server and asserts:
 *
 *   1. First login for a (user, client) SHOWS the tool consent screen; a
 *      submitted selection mints a token whose `consent` claim carries the
 *      selection PLUS the always-available `ping`.
 *   2. Second login for the SAME user+client SKIPS the consent screen (the
 *      callback redirects straight to the client with a code) and the minted
 *      token reuses the remembered selection (+ `ping`).
 *   3. A DIFFERENT user still sees the consent screen (records are isolated
 *      per (user, client)).
 *
 * The re-prompt-on-new-tool path (a newly-added tool re-shows the screen
 * pre-filled) is covered by the SDK unit test
 * `oauth.callback.consent-gate.flow.spec.ts` — it requires mutating the tool
 * set, which an already-booted server with an in-memory store cannot do here.
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.consent-remember.ts';
const REDIRECT_URI = 'http://127.0.0.1:9877/callback';
const CLIENT_ID = 'consent-remember-client';

function makePkce(): { verifier: string; challenge: string } {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function buildAuthorizeUrl(baseUrl: string, challenge: string): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'read write');
  return url.toString();
}

async function startAuthorization(baseUrl: string, challenge: string) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return { pendingAuthId: match![1], html };
}

async function getCallback(baseUrl: string, params: Record<string, string | string[]>): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, vv));
    else url.searchParams.set(k, v);
  }
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

async function exchangeToken(baseUrl: string, code: string, verifier: string): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  return fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

function consentClaimOf(token: string): { enabled?: boolean; selectedTools?: string[] } | undefined {
  const payload = decodeJwtPayload(token);
  return payload['consent'] as { enabled?: boolean; selectedTools?: string[] } | undefined;
}

/** Run a full authorize → consent-submit → token exchange, returning the token. */
async function loginWithConsent(baseUrl: string, email: string, tools: string[]): Promise<string> {
  const { verifier, challenge } = makePkce();
  const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

  const res = await getCallback(baseUrl, {
    pending_auth_id: pendingAuthId,
    email,
    consent_submitted: '1',
    tools,
  });
  expect([302, 303]).toContain(res.status);
  const code = new URL(res.headers.get('location')!).searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenRes = await exchangeToken(baseUrl, code!, verifier);
  expect(tokenRes.status).toBe(200);
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

describe('LOCAL-mode auth E2E — consent mode + rememberConsent', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('first login for a user SHOWS the consent screen', async () => {
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

    const res = await getCallback(baseUrl, { pending_auth_id: pendingAuthId, email: 'remember@test.local' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Select Tools to Enable');
    expect(html).toContain('create-note');
  });

  it('SKIPS the consent screen on a second login for the same user+client and reuses the remembered selection', async () => {
    const email = 'returning@test.local';

    // First login: submit a partial selection (`create-note`); `ping` is excluded.
    const firstToken = await loginWithConsent(baseUrl, email, ['create-note']);
    expect(new Set(consentClaimOf(firstToken)?.selectedTools)).toEqual(new Set(['create-note', 'ping']));

    // Second login (FIRST visit — no consent submission). With rememberConsent the
    // callback must SKIP the screen and redirect straight to the client with a code.
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);
    const res = await getCallback(baseUrl, { pending_auth_id: pendingAuthId, email });

    // A redirect (NOT a 200 consent page) proves the screen was skipped.
    expect([302, 303]).toContain(res.status);
    const code = new URL(res.headers.get('location')!).searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await exchangeToken(baseUrl, code!, verifier);
    expect(tokenRes.status).toBe(200);
    const secondToken = ((await tokenRes.json()) as { access_token: string }).access_token;

    // The remembered selection (+ always-available `ping`) is reused verbatim.
    const claim = consentClaimOf(secondToken);
    expect(claim?.enabled).toBe(true);
    expect(new Set(claim?.selectedTools)).toEqual(new Set(['create-note', 'ping']));
  });

  it('still SHOWS the consent screen for a DIFFERENT user (records are isolated per user)', async () => {
    // Seed a remembered selection for one user.
    await loginWithConsent(baseUrl, 'userA@test.local', ['list-notes']);

    // A different user has no remembered record → the screen is shown.
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);
    const res = await getCallback(baseUrl, { pending_auth_id: pendingAuthId, email: 'userB@test.local' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Select Tools to Enable');
  });
});
