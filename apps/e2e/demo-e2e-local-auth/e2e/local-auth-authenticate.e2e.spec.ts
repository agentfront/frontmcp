/**
 * E2E Tests for FrontMCP LOCAL-mode CUSTOM `authenticate` (Checkpoint 3a).
 *
 * Drives the full OAuth 2.1 authorization-code + PKCE flow over real HTTP
 * against a `auth.mode: 'local'` server configured with a custom `authenticate`
 * verifier and a declarative `login.fields` (a single `apiKey` field). Asserts:
 *
 *   - the login page renders the custom field (not the default email form);
 *   - a CORRECT api key mints a token carrying the custom `tenantId` claim;
 *   - a WRONG api key re-renders the login page with the error (no code, no
 *     redirect — login does not complete);
 *   - the minted token is accepted by the MCP endpoint (full round-trip) and the
 *     claim is readable from the JWT.
 *
 * The verifier secret + claim are synthetic test values (no PII).
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { base64urlDecode, generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.authenticate.ts';

const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'local-authenticate-client';
const GOOD_API_KEY = 'sk-test-fixed-secret';
const BAD_API_KEY = 'sk-test-wrong';

interface PkcePair {
  verifier: string;
  challenge: string;
}

function makePkce(): PkcePair {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function buildAuthorizeUrl(baseUrl: string, challenge: string, opts?: { scope?: string; state?: string }): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (opts?.scope) url.searchParams.set('scope', opts.scope);
  if (opts?.state) url.searchParams.set('state', opts.state);
  return url.toString();
}

/** GET /oauth/authorize and extract the pending_auth_id from the custom login page. */
async function startAuthorization(baseUrl: string, challenge: string, opts?: { scope?: string; state?: string }) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge, opts), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return { pendingAuthId: match![1], html };
}

/** GET /oauth/callback with an apiKey; returns the raw Response (caller asserts outcome). */
async function submitLogin(baseUrl: string, pendingAuthId: string, apiKey: string, opts?: { state?: string }) {
  const url = new URL(`${baseUrl}/oauth/callback`);
  url.searchParams.set('pending_auth_id', pendingAuthId);
  url.searchParams.set('apiKey', apiKey);
  if (opts?.state) url.searchParams.set('state', opts.state);
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

/** POST /oauth/token with an authorization_code grant (urlencoded). */
async function exchangeToken(baseUrl: string, params: { code: string; verifier: string }): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: params.verifier,
  });
  return fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  const json = new TextDecoder().decode(base64urlDecode(payloadB64));
  return JSON.parse(json) as Record<string, unknown>;
}

describe('LOCAL-mode custom authenticate() E2E (Checkpoint 3a)', () => {
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

  it('renders the custom apiKey login field (not the default email form)', async () => {
    const { challenge } = makePkce();
    const { html } = await startAuthorization(baseUrl, challenge, { scope: 'read' });
    expect(html).toContain('Sign in with your API key');
    expect(html).toContain('name="apiKey"');
    expect(html).toContain('type="password"');
    // The default email/name form must be gone.
    expect(html).not.toContain('name="email"');
  });

  it('mints a token carrying the custom claim when the API key is correct', async () => {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read', state: 'st-ok' });

    const res = await submitLogin(baseUrl, pendingAuthId, GOOD_API_KEY, { state: 'st-ok' });
    // Correct key → redirect back to the client with a code.
    expect([302, 303]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const locUrl = new URL(location!);
    expect(`${locUrl.protocol}//${locUrl.host}`).toBe('http://127.0.0.1:9876');
    const code = locUrl.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(locUrl.searchParams.get('state')).toBe('st-ok');

    const tokenRes = await exchangeToken(baseUrl, { code: code!, verifier });
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe('Bearer');

    // The custom claim returned by authenticate() must be embedded in the token.
    const payload = decodeJwtPayload(body.access_token);
    expect(payload['tenantId']).toBe('acme-corp');
    expect(payload['plan']).toBe('enterprise');
    // A subject was derived (per-account strategy from the apiKey).
    expect(payload['sub']).toBeTruthy();
  });

  it('re-renders the login page with an error when the API key is wrong (no code, not authorized)', async () => {
    const { challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read' });

    const res = await submitLogin(baseUrl, pendingAuthId, BAD_API_KEY);
    // Wrong key → NOT a redirect; the login page is re-rendered (HTML 200).
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Invalid API key');
    // The custom field is still present so the user can retry.
    expect(html).toContain('name="apiKey"');
    // Crucially: no authorization code was issued (no redirect Location).
    expect(res.headers.get('location')).toBeNull();
  });

  it('the minted token is accepted by the MCP endpoint and the claim is readable (full round-trip)', async () => {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read write' });
    const res = await submitLogin(baseUrl, pendingAuthId, GOOD_API_KEY);
    const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
    const { access_token } = (await (await exchangeToken(baseUrl, { code, verifier })).json()) as {
      access_token: string;
    };

    // Claim is readable from the JWT.
    expect(decodeJwtPayload(access_token)['tenantId']).toBe('acme-corp');

    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token: access_token },
    }).buildAndConnect();
    try {
      expect(client.isConnected()).toBe(true);
      const tools = await client.tools.list();
      expect(tools).toContainTool('create-note');
    } finally {
      await client.disconnect();
    }
  });
});
