/**
 * E2E regression guard for GHSA-2c4g-9c8x-6m8g — authentication bypass via the
 * client-controlled `incremental` flag.
 *
 * `auth.mode: 'local'` makes the app's `authenticate()` callback THE credential
 * boundary. A request parameter must never be sufficient to skip it. Three
 * separate forgeries are pinned here, because closing only the first one leaves
 * the bypass reachable through the other two:
 *
 *   1. `/oauth/callback?incremental=true` on a pending record the server created
 *      as NON-incremental — the callback must not honour the query flag.
 *   2. `/oauth/authorize?mode=incremental` — an unauthenticated caller must not
 *      be able to mark its own pending record incremental.
 *   3. `/oauth/authorize?app=<id>` — same, via the implicit trigger.
 *
 * Incremental authorization is for an ALREADY-authenticated user, so it is
 * legitimate only when the server can prove that. Until it can, every path here
 * must fall back to the ordinary login + `authenticate()` gate.
 *
 * The happy path is asserted too: these tests must fail if the fix over-corrects
 * and breaks ordinary login.
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.authenticate.ts';

const REDIRECT_URI = 'http://127.0.0.1:9878/callback';
const CLIENT_ID = 'local-incremental-bypass-client';
/** Matches EXPECTED_API_KEY in main.authenticate.ts (synthetic test value). */
const GOOD_API_KEY = 'sk-test-fixed-secret';

function makePkce(): { verifier: string; challenge: string } {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

/**
 * Start an authorization. `extraParams` lets a test inject the forged
 * incremental triggers (`mode`, `app`) an attacker would supply.
 */
function buildAuthorizeUrl(baseUrl: string, challenge: string, extraParams: Record<string, string> = {}): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function startAuthorization(
  baseUrl: string,
  challenge: string,
  extraParams: Record<string, string> = {},
): Promise<{ html: string; pendingAuthId: string }> {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge, extraParams), {
    method: 'GET',
    redirect: 'manual',
  });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return { html, pendingAuthId: match![1] };
}

/** Submit the callback exactly as an attacker would — no credential at all. */
function callback(baseUrl: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

/** The authorization code from a 302, or undefined when none was issued. */
function codeFrom(res: Response): string | undefined {
  const location = res.headers.get('location');
  if (!location) return undefined;
  return new URL(location).searchParams.get('code') ?? undefined;
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

describe('LOCAL-mode incremental-auth bypass (GHSA-2c4g-9c8x-6m8g)', () => {
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

  it('does not issue a code when the callback claims incremental=true on a non-incremental pending record', async () => {
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

    const res = await callback(baseUrl, { pending_auth_id: pendingAuthId, incremental: 'true' });

    expect(codeFrom(res)).toBeUndefined();
  });

  it('does not mint a usable access token through the incremental=true callback', async () => {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

    const res = await callback(baseUrl, {
      pending_auth_id: pendingAuthId,
      incremental: 'true',
      app_id: 'notes',
    });
    const code = codeFrom(res);
    if (code === undefined) return; // No code issued — the gate held.

    // A code slipped out; prove the full impact so the failure is unambiguous.
    const tokenRes = await exchangeToken(baseUrl, code, verifier);
    expect(tokenRes.status).not.toBe(200);
  });

  it('ignores a client-supplied mode=incremental on /oauth/authorize', async () => {
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { mode: 'incremental' });

    // The pending record must not have been marked incremental server-side, so
    // the credential-free callback is still refused.
    const res = await callback(baseUrl, { pending_auth_id: pendingAuthId });

    expect(codeFrom(res)).toBeUndefined();
  });

  it('ignores a client-supplied app= on /oauth/authorize and still demands credentials', async () => {
    const { challenge } = makePkce();
    const { html, pendingAuthId } = await startAuthorization(baseUrl, challenge, { app: 'notes' });

    // An unauthenticated caller must get the ordinary login form, not the bare
    // "Authorize" page that carries no credential prompt.
    expect(html).toContain('name="apiKey"');
    expect(html).not.toContain('name="incremental"');

    const res = await callback(baseUrl, {
      pending_auth_id: pendingAuthId,
      app_id: 'notes',
      incremental: 'true',
    });

    expect(codeFrom(res)).toBeUndefined();
  });

  it('still completes an ordinary login with the correct credential', async () => {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

    const res = await callback(baseUrl, { pending_auth_id: pendingAuthId, apiKey: GOOD_API_KEY });
    expect([302, 303]).toContain(res.status);

    const code = codeFrom(res);
    expect(code).toBeTruthy();

    const tokenRes = await exchangeToken(baseUrl, code!, verifier);
    expect(tokenRes.status).toBe(200);

    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token: accessToken },
    }).buildAndConnect();
    try {
      const tools = await client.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    } finally {
      await client.disconnect();
    }
  });

  it('still refuses an ordinary login with a wrong credential', async () => {
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

    const res = await callback(baseUrl, { pending_auth_id: pendingAuthId, apiKey: 'sk-wrong' });

    expect(codeFrom(res)).toBeUndefined();
  });
});
