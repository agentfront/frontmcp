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
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

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
