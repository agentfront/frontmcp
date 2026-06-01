/**
 * E2E Tests for the FrontMCP per-session credential VAULT (Checkpoint 3b).
 *
 * Drives the full OAuth 2.1 authorization-code + PKCE flow over real HTTP against
 * a `auth.mode: 'local'` server whose `authenticate()` returns a per-session
 * credential. Asserts, over a real authenticated MCP session:
 *
 *   - `this.credentials.get('acme')` reads the credential the verifier persisted
 *     at login (redacted preview + metadata + key set);
 *   - `this.credentials.requireConnect({ key })` returns a framework-signed
 *     `/oauth/connect?token=…` resume URL when the credential is ABSENT;
 *   - that resume URL renders the mid-session add-credential page (GET), and the
 *     token is rejected when tampered.
 *
 * Secrets are synthetic (no PII) and never asserted in full — only redacted.
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.credentials.ts';

const REDIRECT_URI = 'http://127.0.0.1:9877/callback';
const CLIENT_ID = 'local-credentials-client';
const GOOD_API_KEY = 'sk-test-credentials-secret';

interface PkcePair {
  verifier: string;
  challenge: string;
}

function makePkce(): PkcePair {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function buildAuthorizeUrl(baseUrl: string, challenge: string, scope?: string): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}

async function startAuthorization(baseUrl: string, challenge: string, scope?: string) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge, scope), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1];
}

async function submitLogin(baseUrl: string, pendingAuthId: string, apiKey: string): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  url.searchParams.set('pending_auth_id', pendingAuthId);
  url.searchParams.set('apiKey', apiKey);
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

async function exchangeToken(baseUrl: string, code: string, verifier: string): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Full login → token helper. */
async function login(baseUrl: string): Promise<string> {
  const { verifier, challenge } = makePkce();
  const pendingAuthId = await startAuthorization(baseUrl, challenge, 'read write');
  const res = await submitLogin(baseUrl, pendingAuthId, GOOD_API_KEY);
  expect([302, 303]).toContain(res.status);
  const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
  return exchangeToken(baseUrl, code, verifier);
}

interface ReadCredentialOutput {
  present: boolean;
  preview?: string;
  metadata?: Record<string, unknown>;
  keys: string[];
  connectUrl?: string;
}

describe('LOCAL-mode per-session credential vault E2E (Checkpoint 3b)', () => {
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

  it('reads a credential persisted by authenticate() via this.credentials.get()', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const result = await client.tools.call('read-credential', { key: 'acme' });
      const out = result.json<ReadCredentialOutput>();
      expect(out.present).toBe(true);
      // Redacted preview of the persisted secret 'acme-token-abcdef123456'.
      expect(out.preview).toBe('acm…(23)');
      expect(out.metadata).toEqual({ baseUrl: 'https://acme.example' });
      expect(out.keys).toContain('acme');
    } finally {
      await client.disconnect();
    }
  });

  it('returns a framework-signed /oauth/connect resume URL when a credential is absent', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const result = await client.tools.call('read-credential', { key: 'globex', requireConnect: true });
      const out = result.json<ReadCredentialOutput>();
      expect(out.present).toBe(false);
      expect(out.connectUrl).toBeTruthy();
      expect(out.connectUrl).toContain('/oauth/connect?token=');

      // The resume URL renders the mid-session add-credential page (GET).
      const page = await fetch(out.connectUrl!, { method: 'GET', redirect: 'manual' });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Connect');
      // The signed token round-trips as a hidden field on the connect form.
      expect(html).toContain('name="token"');

      // A tampered token is rejected.
      const tamperedUrl = out.connectUrl!.replace(/token=([^&]+)/, 'token=$1tampered');
      const bad = await fetch(tamperedUrl, { method: 'GET', redirect: 'manual' });
      expect(bad.status).toBe(400);
    } finally {
      await client.disconnect();
    }
  });

  it('mid-session connect ADDS a credential to the existing vault, then this.credentials.get sees it', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      // Ask for a connect URL for 'globex' (absent at login).
      const first = (
        await client.tools.call('read-credential', { key: 'globex', requireConnect: true })
      ).json<ReadCredentialOutput>();
      expect(first.present).toBe(false);
      const connectUrl = first.connectUrl!;

      // POST the connect form with the signed token + apiKey → authenticate() adds globex.
      const tokenParam = new URL(connectUrl).searchParams.get('token')!;
      const form = new URLSearchParams({ token: tokenParam, apiKey: GOOD_API_KEY });
      const submit = await fetch(`${baseUrl}/oauth/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
      });
      expect(submit.status).toBe(200);
      expect(await submit.text()).toContain('connected');

      // The credential is now readable on the SAME session.
      const after = (await client.tools.call('read-credential', { key: 'globex' })).json<ReadCredentialOutput>();
      expect(after.present).toBe(true);
      expect(after.keys).toEqual(expect.arrayContaining(['acme', 'globex']));
    } finally {
      await client.disconnect();
    }
  });
});
