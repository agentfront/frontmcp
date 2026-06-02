/**
 * E2E Tests for FrontMCP LOCAL-mode auth (single-operator, non-federated).
 *
 * Drives the full OAuth 2.1 authorization-code + PKCE flow over real HTTP
 * against a `auth.mode: 'local'` server that signs its own tokens, with NO
 * consent and NO federated providers — so `/oauth/authorize` renders the
 * simple login page and `/oauth/callback` mints a code directly.
 *
 * Exercises the recently-landed local-auth fixes:
 *   - #466  non-federated local login completes (mints a code, no 500)
 *   - #468  `requireEmail: false` mints a code without an email; the derived
 *           anonymous `sub` is STABLE across logins
 *   - #467  discovery docs advertise reachable, host-derived OAuth URLs at root
 *   - #473  `/oauth/token` accepts urlencoded (and hybrid Content-Type) bodies
 *   - #472/#458  `tokenStorage: { sqlite }` survives a server restart
 *   - #471  a verified token whose session is gone is handled cleanly (no 500;
 *           404 "session not found" → re-initialize per MCP Spec 2025-11-25)
 *
 * Lifecycle/env-injection tests use the lower-level `TestServer.start()` API
 * (mirroring demo-e2e-authorities) rather than the `test.use` fixture, because
 * they need per-server env (sqlite path) and explicit restart control.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { base64urlDecode, generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.ts';

// A fixed loopback redirect URI used by all flows in this suite.
const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'local-test-client';

interface PkcePair {
  verifier: string;
  challenge: string;
}

function makePkce(): PkcePair {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

/** Build a fully-specified /oauth/authorize URL with PKCE. */
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

/**
 * GET /oauth/authorize and extract the `pending_auth_id` from the login page.
 * The simple login page embeds `<input type="hidden" name="pending_auth_id" ...>`.
 */
async function startAuthorization(baseUrl: string, challenge: string, opts?: { scope?: string; state?: string }) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge, opts), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  // The simple login page embeds a hidden pending_auth_id input.
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return { pendingAuthId: match![1], html };
}

/**
 * GET /oauth/callback to mint the authorization code, returning the `code`
 * extracted from the redirect Location. `email` is omitted by default so the
 * #468 email-opt-out path is exercised.
 */
async function completeLogin(
  baseUrl: string,
  pendingAuthId: string,
  opts?: { email?: string; name?: string; state?: string },
): Promise<{ code: string; location: URL }> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  url.searchParams.set('pending_auth_id', pendingAuthId);
  if (opts?.email) url.searchParams.set('email', opts.email);
  if (opts?.name) url.searchParams.set('name', opts.name);

  const res = await fetch(url.toString(), { method: 'GET', redirect: 'manual' });
  // A successful login is a 302/303 redirect back to the client redirect_uri.
  expect([302, 303]).toContain(res.status);
  // A successful login redirects back to the client redirect_uri (not an error page).
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  const locUrl = new URL(location!);
  // Must redirect to the registered redirect_uri origin, NOT an error page.
  expect(`${locUrl.protocol}//${locUrl.host}`).toBe('http://127.0.0.1:9876');
  // The redirect must carry an authorization code.
  const code = locUrl.searchParams.get('code');
  expect(code).toBeTruthy();
  if (opts?.state) {
    expect(locUrl.searchParams.get('state')).toBe(opts.state);
  }
  return { code: code!, location: locUrl };
}

/** POST /oauth/token with an authorization_code grant (urlencoded by default). */
async function exchangeToken(
  baseUrl: string,
  params: { code: string; verifier: string },
  opts?: { contentType?: string },
): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: params.verifier,
  });
  return fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': opts?.contentType ?? 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

/** Decode a JWT payload without verifying the signature (test introspection only). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  const json = new TextDecoder().decode(base64urlDecode(payloadB64));
  return JSON.parse(json) as Record<string, unknown>;
}

describe('LOCAL-mode auth E2E (single-operator, non-federated)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
      // tokenStorage defaults to 'memory'; the demo server sets requireEmail: false
      // (the framework default is true) so emailless logins succeed.
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  // ===========================================================
  // #466 — non-federated local login completes (no 500)
  // ===========================================================
  describe('#466 non-federated local login', () => {
    it('renders a simple login page (not a consent/federated page) at /oauth/authorize', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge, { scope: 'read write', state: 'st-466a' });
      // Simple login page has the Sign In heading and the email/name form.
      expect(html).toContain('Sign In');
      expect(html).toContain('name="pending_auth_id"');
      // It must NOT be the federated provider-selection page.
      expect(html).not.toContain('Select a provider');
    });

    it('mints an authorization code via /oauth/callback and exchanges it for a token (no 500 anywhere)', async () => {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read', state: 'st-466b' });
      const { code } = await completeLogin(baseUrl, pendingAuthId, { state: 'st-466b' });

      const tokenRes = await exchangeToken(baseUrl, { code, verifier });
      expect(tokenRes.status).toBe(200);
      const body = (await tokenRes.json()) as { access_token: string; token_type: string; expires_in: number };
      expect(body.token_type).toBe('Bearer');
      expect(typeof body.access_token).toBe('string');
      expect(body.access_token.split('.')).toHaveLength(3); // JWT
      expect(body.expires_in).toBeGreaterThan(0);
    });

    it('the minted access token is accepted by the MCP endpoint (full round-trip)', async () => {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read write' });
      const { code } = await completeLogin(baseUrl, pendingAuthId);
      const tokenRes = await exchangeToken(baseUrl, { code, verifier });
      const { access_token } = (await tokenRes.json()) as { access_token: string };

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

  // ===========================================================
  // #468 — requireEmail: false mints a code without an email,
  //        and the anonymous sub is STABLE.
  // ===========================================================
  describe('#468 email opt-out + stable anonymous sub', () => {
    it('mints a code WITHOUT an email when requireEmail is false', async () => {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read' });
      // Deliberately pass NO email.
      const { code } = await completeLogin(baseUrl, pendingAuthId);
      const tokenRes = await exchangeToken(baseUrl, { code, verifier });
      expect(tokenRes.status).toBe(200);
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const payload = decodeJwtPayload(access_token);
      // The token must carry a subject even with no email supplied.
      expect(payload['sub']).toBeTruthy();
      // No email was supplied, so the email claim must be absent.
      expect(payload['email']).toBeUndefined();
    });

    it('derives a STABLE anonymous sub across two separate emailless logins', async () => {
      // First emailless login.
      const a = makePkce();
      const { pendingAuthId: pid1 } = await startAuthorization(baseUrl, a.challenge);
      const { code: code1 } = await completeLogin(baseUrl, pid1);
      const tok1 = (await (await exchangeToken(baseUrl, { code: code1, verifier: a.verifier })).json()) as {
        access_token: string;
      };
      const sub1 = decodeJwtPayload(tok1.access_token)['sub'];

      // Second emailless login (fresh authorize → callback → token).
      const b = makePkce();
      const { pendingAuthId: pid2 } = await startAuthorization(baseUrl, b.challenge);
      const { code: code2 } = await completeLogin(baseUrl, pid2);
      const tok2 = (await (await exchangeToken(baseUrl, { code: code2, verifier: b.verifier })).json()) as {
        access_token: string;
      };
      const sub2 = decodeJwtPayload(tok2.access_token)['sub'];

      expect(sub1).toBeTruthy();
      // Same operator (anonymousSubject) → same sub each time.
      expect(sub2).toBe(sub1);
    });
  });

  // ===========================================================
  // #467 — discovery docs advertise reachable, host-derived URLs
  //        with OAuth endpoints at root.
  // ===========================================================
  describe('#467 discovery documents', () => {
    it('oauth-authorization-server advertises host-derived endpoints at root', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });
      expect(res.status).toBe(200);
      const meta = (await res.json()) as Record<string, string>;

      // Endpoints must be reachable absolute URLs rooted at the SAME origin the
      // client actually reached (host-derived), and mounted at root /oauth/*.
      expect(meta['issuer']).toBe(baseUrl);
      expect(meta['authorization_endpoint']).toBe(`${baseUrl}/oauth/authorize`);
      expect(meta['token_endpoint']).toBe(`${baseUrl}/oauth/token`);
      expect(meta['jwks_uri']).toBe(`${baseUrl}/.well-known/jwks.json`);
      expect(meta['registration_endpoint']).toBe(`${baseUrl}/oauth/register`);

      // Sanity: every advertised endpoint must actually be on this origin (no
      // stale localhost:hardcoded-port from boot-time issuer).
      for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'registration_endpoint']) {
        expect(meta[key]).toMatch(new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
      }
    });

    it('the advertised authorization_endpoint and jwks_uri are actually reachable', async () => {
      const meta = (await (
        await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, { headers: { Accept: 'application/json' } })
      ).json()) as Record<string, string>;

      // jwks_uri returns a JWKS document.
      const jwksRes = await fetch(meta['jwks_uri'], { headers: { Accept: 'application/json' } });
      expect(jwksRes.status).toBe(200);
      const jwks = (await jwksRes.json()) as { keys: unknown[] };
      expect(Array.isArray(jwks.keys)).toBe(true);

      // authorization_endpoint with a valid PKCE request returns the login page.
      const { challenge } = makePkce();
      const authUrl = new URL(meta['authorization_endpoint']);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      const authRes = await fetch(authUrl.toString(), { redirect: 'manual' });
      expect(authRes.status).toBe(200);
    });

    it('oauth-protected-resource advertises this origin as its authorization server', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });
      expect(res.status).toBe(200);
      const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
      expect(Array.isArray(meta.authorization_servers)).toBe(true);
      expect(meta.authorization_servers.length).toBeGreaterThan(0);
      // The advertised AS must be host-derived (same origin the client reached),
      // not a hardcoded host — this is the #467 fix.
      expect(meta.authorization_servers[0]).toBe(baseUrl);
      // The protected-resource URL must reflect the request host (host-derived).
      const expectedHost = new URL(baseUrl).host;
      expect(meta.resource).toContain(expectedHost);
    });
  });

  // ===========================================================
  // /oauth/userinfo — advertised by discovery, must serve claims.
  //
  // The oauth-authorization-server document advertises a `userinfo_endpoint`;
  // it must actually verify the Bearer token and return the user's `sub`
  // (no longer a 404). An invalid/forged token must be rejected with 401.
  // ===========================================================
  describe('/oauth/userinfo', () => {
    async function mintAccessToken(opts?: { email?: string }): Promise<string> {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read' });
      const { code } = await completeLogin(baseUrl, pendingAuthId, opts);
      const body = (await (await exchangeToken(baseUrl, { code, verifier })).json()) as { access_token: string };
      return body.access_token;
    }

    it('is advertised by the discovery document and returns the sub for a valid token', async () => {
      const meta = (await (
        await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, { headers: { Accept: 'application/json' } })
      ).json()) as Record<string, string>;
      // The discovery document advertises the userinfo endpoint at root.
      expect(meta['userinfo_endpoint']).toBe(`${baseUrl}/oauth/userinfo`);

      const token = await mintAccessToken({ email: 'userinfo@example.com' });
      const res = await fetch(meta['userinfo_endpoint'], {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      expect(res.status).toBe(200);
      const claims = (await res.json()) as { sub?: string; email?: string };
      // The token's subject must be echoed back (proves it was verified, not 404).
      expect(claims.sub).toBeTruthy();
      // The email supplied at login should round-trip as a userinfo claim.
      expect(claims.email).toBe('userinfo@example.com');
    });

    it('rejects a request with NO bearer token with 401', async () => {
      const res = await fetch(`${baseUrl}/oauth/userinfo`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a forged/tampered token with 401 (not 200, not 5xx)', async () => {
      const valid = await mintAccessToken();
      // Replace the HS256 signature so the MAC no longer matches the secret.
      const [h, p] = valid.split('.');
      const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const res = await fetch(`${baseUrl}/oauth/userinfo`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tampered}`, Accept: 'application/json' },
      });
      expect(res.status).toBeLessThan(500);
      expect(res.status).toBe(401);
    });
  });

  // ===========================================================
  // #473 — /oauth/token accepts urlencoded and tolerates hybrid
  //        Content-Type.
  // ===========================================================
  describe('#473 token endpoint Content-Type handling', () => {
    it('accepts a normal application/x-www-form-urlencoded body', async () => {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read' });
      const { code } = await completeLogin(baseUrl, pendingAuthId);

      const res = await exchangeToken(
        baseUrl,
        { code, verifier },
        { contentType: 'application/x-www-form-urlencoded' },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { access_token: string };
      expect(body.access_token.split('.')).toHaveLength(3);
    });

    it('tolerates a hybrid Content-Type (application/json, application/x-www-form-urlencoded)', async () => {
      const { verifier, challenge } = makePkce();
      const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read' });
      const { code } = await completeLogin(baseUrl, pendingAuthId);

      // The MCP Inspector token refresh sends a hybrid Content-Type; the body
      // is still urlencoded. The endpoint must parse it and mint a token.
      const res = await exchangeToken(
        baseUrl,
        { code, verifier },
        { contentType: 'application/json, application/x-www-form-urlencoded' },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { access_token: string; token_type: string };
      expect(body.token_type).toBe('Bearer');
      expect(body.access_token.split('.')).toHaveLength(3);
    });

    it('returns a precise 400 (not 500) for a malformed token body', async () => {
      const res = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code', // missing code / redirect_uri / client_id / verifier
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description?: string };
      expect(body.error).toBe('invalid_request');
    });
  });
});

// ===========================================================
// #472 / #458 — sqlite token storage survives a restart
// ===========================================================
describe('#472/#458 sqlite tokenStorage restart persistence', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'frontmcp-local-auth-sqlite-'));
    sqlitePath = join(tmpDir, 'auth-tokens.sqlite');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('an authorization code minted before restart can be exchanged after restart (same sqlite file)', async () => {
    const { verifier, challenge } = makePkce();

    // --- First server instance: mint an authorization code, then stop. ---
    const server1 = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { TOKEN_STORAGE_SQLITE_PATH: sqlitePath },
      debug: process.env['DEBUG'] === '1',
    });

    let code: string;
    try {
      const base1 = server1.info.baseUrl;
      const { pendingAuthId } = await startAuthorization(base1, challenge, { scope: 'read' });
      ({ code } = await completeLogin(base1, pendingAuthId));
      expect(code).toBeTruthy();
    } finally {
      await server1.stop();
    }

    // The sqlite file must have been created on disk by the first instance.
    expect(existsSync(sqlitePath)).toBe(true);

    // --- Second server instance over the SAME sqlite file. ---
    const server2 = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { TOKEN_STORAGE_SQLITE_PATH: sqlitePath },
      debug: process.env['DEBUG'] === '1',
    });

    try {
      const base2 = server2.info.baseUrl;
      // The code minted by server1 must still be redeemable on server2 because
      // the authorization store is backed by the shared sqlite file
      // (code minted pre-restart must be exchangeable post-restart).
      const res = await exchangeToken(base2, { code, verifier });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { access_token: string; token_type: string };
      expect(body.token_type).toBe('Bearer');
      expect(body.access_token.split('.')).toHaveLength(3);
    } finally {
      await server2.stop();
    }
  }, 120000);

  it('a refresh token minted before restart can be refreshed after restart', async () => {
    const { verifier, challenge } = makePkce();
    const path2 = join(tmpDir, 'auth-tokens-refresh.sqlite');

    // --- First instance: complete the full flow to obtain a refresh token. ---
    const server1 = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { TOKEN_STORAGE_SQLITE_PATH: path2 },
      debug: process.env['DEBUG'] === '1',
    });

    let refreshToken: string;
    try {
      const base1 = server1.info.baseUrl;
      const { pendingAuthId } = await startAuthorization(base1, challenge, { scope: 'read' });
      const { code } = await completeLogin(base1, pendingAuthId);
      const tokenBody = (await (await exchangeToken(base1, { code, verifier })).json()) as {
        refresh_token?: string;
      };
      // The authorization_code grant should return a refresh_token.
      expect(tokenBody.refresh_token).toBeTruthy();
      refreshToken = tokenBody.refresh_token!;
    } finally {
      await server1.stop();
    }

    // --- Second instance over the same file: refresh must still work. ---
    const server2 = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { TOKEN_STORAGE_SQLITE_PATH: path2 },
      debug: process.env['DEBUG'] === '1',
    });

    try {
      const base2 = server2.info.baseUrl;
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      });
      const res = await fetch(`${base2}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      // Refresh token minted pre-restart must still work post-restart.
      expect(res.status).toBe(200);
      const body = (await res.json()) as { access_token: string; refresh_token?: string };
      expect(body.access_token.split('.')).toHaveLength(3);
    } finally {
      await server2.stop();
    }
  }, 120000);
});

// ===========================================================
// #471 — verified token whose session is gone returns 401 (not 500)
// ===========================================================
describe('#471 verified token with gone session is handled cleanly (no 500)', () => {
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

  async function mintToken(): Promise<string> {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read write' });
    const { code } = await completeLogin(baseUrl, pendingAuthId);
    const body = (await (await exchangeToken(baseUrl, { code, verifier })).json()) as { access_token: string };
    return body.access_token;
  }

  it('a VERIFIED token with a non-existent mcp-session-id is handled cleanly (no 500)', async () => {
    const token = await mintToken();

    // Send a non-initialize MCP request referencing a session the server never
    // created. The bearer token VERIFIES (it was just minted), but the session
    // is gone. This is the #471 path: previously this threw a 500; the fix
    // returns a clean client-directed response instead.
    //
    // The contract here is twofold:
    //  1. It must NEVER be a 500 (the #471 regression).
    //  2. It must be a clean client error telling the client to recover —
    //     per the MCP Spec 2025-11-25 / repo convention, an invalid or missing
    //     session id maps to HTTP 404 ("session not found" → re-initialize);
    //     a rejected token would be 401. Either is acceptable; a 5xx is not.
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'mcp-session-id': 'nonexistent-session-00000000-0000-0000-0000-000000000000',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    // 1. Must NOT be a 5xx (the core #471 guarantee).
    expect(res.status).toBeLessThan(500);
    // 2. Must be a clean client-recovery status (404 session-gone, or 401).
    expect([401, 404]).toContain(res.status);

    // The body must be a well-formed JSON-RPC error envelope, proving the
    // request was handled (not an unhandled crash / empty 500 body).
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    const parsed = JSON.parse(text) as { jsonrpc?: string; error?: { code: number; message: string } };
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.error).toBeDefined();
    expect(typeof parsed.error?.code).toBe('number');
  });

  it('the same token without a session id can still initialize (control: token itself is valid)', async () => {
    const token = await mintToken();
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      expect(client.isConnected()).toBe(true);
    } finally {
      await client.disconnect();
    }
  });

  it('unauthenticated request is rejected with 401 + WWW-Authenticate (allowDefaultPublic: false)', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });
});

// ===========================================================
// SECURITY — gateway tokens are cryptographically verified
//
// Regression guard: before the gateway-verify fix, the verify path only
// base64-decoded the payload, so a forged/tampered JWT with the right shape
// was ACCEPTED. These tests assert that a token whose HS256 signature does not
// match the server's secret is REJECTED with 401 (a clean client error, never
// a 5xx), while the matching freshly-minted token is still accepted.
// ===========================================================
describe('SECURITY: forged/tampered Bearer token is rejected with 401', () => {
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

  async function mintToken(): Promise<string> {
    const { verifier, challenge } = makePkce();
    const { pendingAuthId } = await startAuthorization(baseUrl, challenge, { scope: 'read write' });
    const { code } = await completeLogin(baseUrl, pendingAuthId);
    const body = (await (await exchangeToken(baseUrl, { code, verifier })).json()) as { access_token: string };
    return body.access_token;
  }

  /** POST an MCP initialize with the given bearer token; return the HTTP response. */
  async function callWithToken(token: string): Promise<Response> {
    return fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
  }

  it('a token with a TAMPERED signature is rejected with 401 (not accepted, not 5xx)', async () => {
    const valid = await mintToken();
    // Keep header + payload intact (still decodes to a well-formed JWT shape),
    // but replace the HS256 signature so the MAC no longer matches the secret.
    const [h, p] = valid.split('.');
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    const res = await callWithToken(tampered);

    expect(res.status).toBeLessThan(500); // never a crash
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('a token with a SWAPPED payload (different sub/scope) is rejected with 401', async () => {
    const valid = await mintToken();
    const [h, , sig] = valid.split('.');
    // Re-encode a payload claiming elevated scope + a different subject. The
    // header and signature are from the real token, so the signature can no
    // longer cover this tampered payload.
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', scope: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const forged = `${h}.${forgedPayload}.${sig}`;

    const res = await callWithToken(forged);

    expect(res.status).toBeLessThan(500);
    expect(res.status).toBe(401);
  });

  it('the matching freshly-minted token is still ACCEPTED (control)', async () => {
    const token = await mintToken();
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      expect(client.isConnected()).toBe(true);
    } finally {
      await client.disconnect();
    }
  });
});
