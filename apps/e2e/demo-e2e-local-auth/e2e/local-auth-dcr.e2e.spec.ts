/**
 * E2E Tests for the local-AS Dynamic Client Registration control surface (#462).
 *
 * Drives a `auth.mode: 'local'` server whose `auth.dcr` block is configured via
 * env (see src/main.dcr.ts) over real HTTP, covering:
 *   - DCR disabled            → POST /oauth/register → 404; AS metadata omits
 *                               registration_endpoint
 *   - initialAccessToken      → 401 without/with-wrong bearer, 201 with the
 *                               correct one
 *   - allowedRedirectUris     → register + authorize reject an unlisted
 *                               redirect_uri
 *   - allowedClientIds        → authorize rejects an unlisted client_id
 *   - pre-registered client   → authorize accepts it WITHOUT a DCR round-trip
 *   - default (no dcr)        → register still works (control)
 *   - SQLite tokenStorage     → a registered client is known after a restart (#1478)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { browserFetch } from './browser-fetch';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.dcr.ts';

const PREREGISTERED_CLIENT_ID = 'preregistered-client';
const PREREGISTERED_REDIRECT_URI = 'http://127.0.0.1:9876/callback';

function challenge(): string {
  return sha256Base64url(generateCodeVerifier());
}

/** Build a /oauth/authorize URL with a full PKCE request. */
function authorizeUrl(baseUrl: string, opts: { clientId: string; redirectUri: string }): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('code_challenge', challenge());
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'read');
  return url.toString();
}

async function postRegister(
  baseUrl: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

async function asMetadata(baseUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, {
    headers: { Accept: 'application/json' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe('#462 local-AS DCR — disabled', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { DCR_ENABLED: 'false' },
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('POST /oauth/register responds 404 (endpoint behaves as if absent)', async () => {
    const res = await postRegister(baseUrl, { redirect_uris: ['http://localhost:9876/cb'] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('access_denied');
  });

  it('AS metadata omits registration_endpoint when DCR is disabled', async () => {
    const meta = await asMetadata(baseUrl);
    expect(meta['authorization_endpoint']).toBe(`${baseUrl}/oauth/authorize`);
    expect(meta['registration_endpoint']).toBeUndefined();
  });
});

describe('#462 local-AS DCR — initialAccessToken required', () => {
  let server: TestServer;
  let baseUrl: string;
  const IAT = 'e2e-initial-access-token';

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: { DCR_INITIAL_ACCESS_TOKEN: IAT },
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('rejects registration with no bearer (401 invalid_token)', async () => {
    const res = await postRegister(baseUrl, { redirect_uris: ['http://localhost:9876/cb'] });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_token');
  });

  it('rejects registration with a wrong bearer (401)', async () => {
    const res = await postRegister(
      baseUrl,
      { redirect_uris: ['http://localhost:9876/cb'] },
      { Authorization: 'Bearer wrong-token' },
    );
    expect(res.status).toBe(401);
  });

  it('accepts registration with the correct bearer (201 + client_id)', async () => {
    const res = await postRegister(
      baseUrl,
      { redirect_uris: ['http://localhost:9876/cb'] },
      { Authorization: `Bearer ${IAT}` },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id?: string };
    expect(typeof body.client_id).toBe('string');
  });
});

describe('#462 local-AS DCR — redirect_uri + client_id allowlists', () => {
  let server: TestServer;
  let baseUrl: string;
  const ALLOWED_REDIRECT = 'http://127.0.0.1:9876/callback';

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      env: {
        DCR_ALLOWED_REDIRECT_URIS: ALLOWED_REDIRECT,
        DCR_ALLOWED_CLIENT_IDS: 'allowed-client',
      },
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('register rejects a redirect_uri not on the allowlist (400 invalid_redirect_uri)', async () => {
    const res = await postRegister(baseUrl, { redirect_uris: ['https://evil.example.com/cb'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('authorize rejects a redirect_uri not on the allowlist (error page, no redirect)', async () => {
    const res = await fetch(
      authorizeUrl(baseUrl, { clientId: 'allowed-client', redirectUri: 'https://evil.example.com/cb' }),
      {
        redirect: 'manual',
      },
    );
    // Unlisted redirect_uri must NOT be redirected to → 400 error page.
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Authorization Error');
  });

  it('authorize rejects a client_id not on the allowlist', async () => {
    const res = await fetch(authorizeUrl(baseUrl, { clientId: 'not-allowed', redirectUri: ALLOWED_REDIRECT }), {
      redirect: 'manual',
    });
    // redirect_uri IS allowed, so the client_id rejection is delivered as an
    // OAuth error on the redirect back to the (allowed) redirect_uri.
    expect([302, 303]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const loc = new URL(location!);
    expect(loc.searchParams.get('error')).toBeTruthy();
    expect(loc.searchParams.get('error_description') ?? '').toContain('client_id');
  });

  it('authorize accepts an allowlisted client_id + redirect_uri (renders login page)', async () => {
    const res = await fetch(authorizeUrl(baseUrl, { clientId: 'allowed-client', redirectUri: ALLOWED_REDIRECT }), {
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign In');
  });
});

describe('#462 local-AS DCR — pre-registered trusted client', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      // DCR disabled, but a trusted client is pre-registered → authorize must
      // still accept it WITHOUT any DCR round-trip.
      env: {
        DCR_ENABLED: 'false',
        DCR_PREREGISTERED: '1',
        DCR_ALLOWED_CLIENT_IDS: PREREGISTERED_CLIENT_ID,
        DCR_ALLOWED_REDIRECT_URIS: PREREGISTERED_REDIRECT_URI,
      },
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('DCR is disabled (register 404) but the pre-registered client authorizes successfully', async () => {
    // Registration is closed.
    const reg = await postRegister(baseUrl, { redirect_uris: [PREREGISTERED_REDIRECT_URI] });
    expect(reg.status).toBe(404);

    // The pre-registered client reaches the login page (no DCR needed).
    const res = await fetch(
      authorizeUrl(baseUrl, { clientId: PREREGISTERED_CLIENT_ID, redirectUri: PREREGISTERED_REDIRECT_URI }),
      { redirect: 'manual' },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign In');
  });
});

describe('#462 local-AS DCR — default behavior preserved (no dcr config)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      // No DCR_* env → empty dcr block → today's behavior (dev: enabled).
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('register still works for a localhost client (201) and AS advertises registration_endpoint', async () => {
    const res = await postRegister(baseUrl, { redirect_uris: ['http://localhost:9876/cb'] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id?: string };
    expect(typeof body.client_id).toBe('string');

    const meta = await asMetadata(baseUrl);
    expect(meta['registration_endpoint']).toBe(`${baseUrl}/oauth/register`);
  });
});

describe('#1478 local-AS DCR — registered clients survive a restart on a SQLite tokenStorage', () => {
  const REDIRECT = 'http://127.0.0.1:9876/callback';
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'frontmcp-dcr-clients-'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function startServer(sqlitePath: string, port?: number): Promise<TestServer> {
    return TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      port,
      startupTimeout: 60000,
      env: {
        TOKEN_STORAGE_SQLITE_PATH: sqlitePath,
        REQUIRE_REGISTERED_CLIENTS: 'true',
        JWT_SECRET: 'dcr-clients-e2e-jwt-secret-32-bytes-min',
      },
      debug: process.env['DEBUG'] === '1',
    });
  }

  /** Sign in on the login page and redeem the code with `clientSecret`; returns the token endpoint's status. */
  async function signIn(baseUrl: string, clientId: string, clientSecret: string): Promise<number> {
    const verifier = generateCodeVerifier();
    const url = new URL(`${baseUrl}/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: sha256Base64url(verifier),
      code_challenge_method: 'S256',
    }).toString();
    const page = await browserFetch(url.toString(), { redirect: 'manual' });
    expect(page.status).toBe(200);
    const pendingAuthId = (await page.text()).match(/name="pending_auth_id"\s+value="([^"]+)"/)?.[1] ?? '';
    const callback = await browserFetch(`${baseUrl}/oauth/callback?pending_auth_id=${pendingAuthId}`, {
      redirect: 'manual',
    });
    expect([302, 303]).toContain(callback.status);
    const code = new URL(callback.headers.get('location') ?? baseUrl).searchParams.get('code') ?? '';
    const token = await browserFetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      }).toString(),
    });
    return token.status;
  }

  it('authorizes a public and a confidential client registered before the restart', async () => {
    const sqlitePath = join(directory, 'tokens.sqlite');
    const first = await startServer(sqlitePath);
    const port = first.info.port;
    let publicClient: { client_id: string };
    let confidentialClient: { client_id: string; client_secret: string };
    try {
      publicClient = (await (await postRegister(first.info.baseUrl, { redirect_uris: [REDIRECT] })).json()) as {
        client_id: string;
      };
      confidentialClient = (await (
        await postRegister(first.info.baseUrl, {
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: 'client_secret_post',
        })
      ).json()) as { client_id: string; client_secret: string };
    } finally {
      await first.stop();
    }

    const second = await startServer(sqlitePath, port);
    const baseUrl = second.info.baseUrl;
    try {
      const page = await fetch(authorizeUrl(baseUrl, { clientId: publicClient.client_id, redirectUri: REDIRECT }));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Sign In');

      expect(await signIn(baseUrl, confidentialClient.client_id, 'not-its-secret')).toBe(400);
      expect(await signIn(baseUrl, confidentialClient.client_id, confidentialClient.client_secret)).toBe(200);

      const unknown = await fetch(authorizeUrl(baseUrl, { clientId: 'never-registered', redirectUri: REDIRECT }));
      expect(unknown.status).toBe(400);
    } finally {
      await second.stop();
    }
  }, 180000);
});
