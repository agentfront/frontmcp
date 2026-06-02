/**
 * E2E for the TOOL-LEVEL `authProviders` credential gate (checkToolCredentials).
 *
 * Drives the OAuth 2.1 authorization-code + PKCE flow over real HTTP against the
 * `auth.mode: 'local'` credentials server (main.credentials.ts). `authenticate()`
 * persists an `acme` credential at login but NOT `globex`. The gated tools:
 *   - `gated-acme`    → authProviders: ['acme']                  (present)
 *   - `gated-globex`  → authProviders: [{ name: 'globex' }]      (absent, required)
 *   - `gated-optional`→ authProviders: [{ name: 'globex', required: false }]
 *
 * Asserts, over a real authenticated MCP session:
 *   - `gated-globex` is REJECTED before execute() with MCP -32001, and the error
 *     data names the missing provider + carries an authUrl;
 *   - `gated-acme` EXECUTES (credential present);
 *   - `gated-optional` EXECUTES (optional provider never gates);
 *   - after the mid-session connect flow ADDS `globex`, `gated-globex` executes.
 *
 * No secrets are returned by the tools (no PII) — only an `ok` marker.
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.credentials.ts';

const REDIRECT_URI = 'http://127.0.0.1:9877/callback';
const CLIENT_ID = 'local-credential-gate-client';
const GOOD_API_KEY = 'sk-test-credentials-secret';

function makePkce(): { verifier: string; challenge: string } {
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

async function startAuthorization(baseUrl: string, challenge: string, scope?: string): Promise<string> {
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

async function login(baseUrl: string): Promise<string> {
  const { verifier, challenge } = makePkce();
  const pendingAuthId = await startAuthorization(baseUrl, challenge, 'read write');
  const res = await submitLogin(baseUrl, pendingAuthId, GOOD_API_KEY);
  expect([302, 303]).toContain(res.status);
  const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
  return exchangeToken(baseUrl, code, verifier);
}

interface GatedOutput {
  ok: true;
  provider: string;
}

describe('LOCAL-mode tool-level authProviders credential gate E2E', () => {
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

  it('rejects a tool whose required provider credential is NOT connected (before execute)', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const result = await client.tools.call('gated-globex', {});
      expect(result.isError).toBe(true);
      // MCP UNAUTHORIZED — the documented tool-level credential gate code.
      expect(result.error?.code).toBe(-32001);
      const data = result.error?.data as { tool?: string; providers?: string[]; authUrl?: string } | undefined;
      expect(data?.providers).toContain('globex');
      // A connect/authorize URL is surfaced so the agent can (re)authorize.
      expect(typeof data?.authUrl).toBe('string');
      expect(data?.authUrl).toContain('/oauth/connect?token=');
    } finally {
      await client.disconnect();
    }
  });

  it('executes a tool whose required provider credential IS connected', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const result = await client.tools.call('gated-acme', {});
      expect(result.isError).toBe(false);
      expect(result.json<GatedOutput>()).toEqual({ ok: true, provider: 'acme' });
    } finally {
      await client.disconnect();
    }
  });

  it('never gates an optional (required:false) provider, even when absent', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      const result = await client.tools.call('gated-optional', {});
      expect(result.isError).toBe(false);
      expect(result.json<GatedOutput>()).toEqual({ ok: true, provider: 'optional' });
    } finally {
      await client.disconnect();
    }
  });

  it('executes the gated tool once the missing credential is connected mid-session', async () => {
    const token = await login(baseUrl);
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      // Gated first — globex is absent.
      const before = await client.tools.call('gated-globex', {});
      expect(before.isError).toBe(true);
      const connectUrl = (before.error?.data as { authUrl?: string } | undefined)?.authUrl;
      expect(connectUrl).toBeTruthy();

      // Connect globex via the framework-signed resume URL (authenticate()'s
      // resume branch ADDS the globex credential to the SAME session vault).
      const tokenParam = new URL(connectUrl!).searchParams.get('token')!;
      const form = new URLSearchParams({ token: tokenParam, apiKey: GOOD_API_KEY });
      const submit = await fetch(`${baseUrl}/oauth/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
      });
      expect(submit.status).toBe(200);
      expect(await submit.text()).toContain('connected');

      // Now the gate passes and execute() runs.
      const after = await client.tools.call('gated-globex', {});
      expect(after.isError).toBe(false);
      expect(after.json<GatedOutput>()).toEqual({ ok: true, provider: 'globex' });
    } finally {
      await client.disconnect();
    }
  });
});
