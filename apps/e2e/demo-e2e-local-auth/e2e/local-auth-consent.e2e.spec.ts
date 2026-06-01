/**
 * E2E Tests for FrontMCP LOCAL-mode auth with CONSENT MODE enabled.
 *
 * Drives the full OAuth 2.1 authorization-code + PKCE flow over real HTTP
 * against a `auth.consent.enabled: true` server, asserting the full lifecycle:
 *
 *   1. /oauth/authorize renders the simple login page (NOT the consent page yet).
 *   2. /oauth/callback (post-login) renders the TOOL CONSENT SCREEN — listing the
 *      offered tools but NOT the `excludedTools` member (`ping`).
 *   3. An empty submit is rejected (requireSelection) by re-rendering.
 *   4. A PARTIAL selection (`create-note` only) mints a code → token whose
 *      `consent` claim carries the selection PLUS the always-available `ping`.
 *   5. At runtime: calling `create-note` succeeds, calling the UN-selected
 *      `list-notes` is REJECTED, and the excluded `ping` is allowed.
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.consent.ts';
const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'consent-test-client';

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

/** GET /oauth/authorize and extract `pending_auth_id` from the login page. */
async function startAuthorization(baseUrl: string, challenge: string) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return { pendingAuthId: match![1], html };
}

/** GET /oauth/callback (post-login). Returns the raw response for inspection. */
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

/** Full happy-path: authorize → consent → select `create-note` → token. */
async function mintConsentToken(baseUrl: string, tools: string[]): Promise<string> {
  const { verifier, challenge } = makePkce();
  const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

  const res = await getCallback(baseUrl, {
    pending_auth_id: pendingAuthId,
    email: 'user@test.local',
    consent_submitted: '1',
    tools,
  });
  expect([302, 303]).toContain(res.status);
  const location = res.headers.get('location');
  const code = new URL(location!).searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenRes = await exchangeToken(baseUrl, code!, verifier);
  expect(tokenRes.status).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

describe('LOCAL-mode auth E2E — consent mode', () => {
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

  // ===========================================================
  // Consent screen rendering
  // ===========================================================
  describe('consent screen', () => {
    it('renders the simple login page at /oauth/authorize (not the consent page yet)', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      expect(html).toContain('Sign In');
      expect(html).not.toContain('Select Tools to Enable');
    });

    it('renders the consent screen after login, listing offered tools but NOT excluded tools', async () => {
      const { challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

      const res = await getCallback(baseUrl, { pending_auth_id: pendingAuthId, email: 'user@test.local' });
      // Consent page is a 200 HTML page (no redirect yet).
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Select Tools to Enable');
      // Offered tools appear...
      expect(html).toContain('create-note');
      expect(html).toContain('list-notes');
      // ...but the excluded `ping` tool is never offered.
      expect(html).not.toContain('value="ping"');
      // The form round-trips the identity so the resubmit re-derives the sub.
      expect(html).toContain('name="email" value="user@test.local"');
    });

    it('rejects an empty submit (requireSelection) by re-rendering the consent screen', async () => {
      const { challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge);

      const res = await getCallback(baseUrl, {
        pending_auth_id: pendingAuthId,
        email: 'user@test.local',
        consent_submitted: '1',
        // no tools selected
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Select Tools to Enable');
      expect(html).toContain('Please select at least one tool to continue.');
    });
  });

  // ===========================================================
  // Token claim reflects the selection (+ excluded tools)
  // ===========================================================
  describe('minted token', () => {
    it('embeds the selected tools PLUS the always-available excluded tool in the consent claim', async () => {
      const token = await mintConsentToken(baseUrl, ['create-note']);
      const payload = decodeJwtPayload(token);
      const consent = payload['consent'] as { enabled?: boolean; selectedTools?: string[] } | undefined;
      expect(consent?.enabled).toBe(true);
      expect(new Set(consent?.selectedTools)).toEqual(new Set(['create-note', 'ping']));
    });
  });

  // ===========================================================
  // Runtime enforcement
  // ===========================================================
  describe('runtime enforcement', () => {
    it('allows a consented tool, REJECTS an un-consented tool, and allows the excluded tool', async () => {
      // Consent only to `create-note` (NOT `list-notes`). `ping` is excluded.
      const token = await mintConsentToken(baseUrl, ['create-note']);

      const client = await McpTestClient.create({
        baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      try {
        // Consented tool → success.
        const created = await client.tools.call('create-note', { title: 'Hi', content: 'There' });
        expect(created.isError).toBe(false);

        // UN-consented tool → rejected at runtime.
        const listed = await client.tools.call('list-notes', {});
        expect(listed.isError).toBe(true);
        expect((listed.text() ?? '').toLowerCase()).toContain('not consented');

        // Excluded tool → always available.
        const pinged = await client.tools.call('ping', {});
        expect(pinged.isError).toBe(false);
        expect(pinged.json<{ ok: boolean }>().ok).toBe(true);
      } finally {
        await client.disconnect();
      }
    });

    it('rejects ALL non-excluded tools when only the excluded tool would remain (still allows ping)', async () => {
      // Select nothing extra is impossible (requireSelection), so select just
      // `list-notes`; `create-note` must then be rejected, `ping` still allowed.
      const token = await mintConsentToken(baseUrl, ['list-notes']);

      const client = await McpTestClient.create({
        baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      try {
        const created = await client.tools.call('create-note', { title: 'x', content: 'y' });
        expect(created.isError).toBe(true);
        expect((created.text() ?? '').toLowerCase()).toContain('not consented');

        const listed = await client.tools.call('list-notes', {});
        expect(listed.isError).toBe(false);

        const pinged = await client.tools.call('ping', {});
        expect(pinged.isError).toBe(false);
      } finally {
        await client.disconnect();
      }
    });
  });
});
