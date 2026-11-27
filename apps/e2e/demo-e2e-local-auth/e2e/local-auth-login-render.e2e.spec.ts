/**
 * E2E for a `login.render` page with its own strict CSP (#1477): the render
 * context names the client's redirect origin, the page puts it in
 * `form-action`, and a POST of its form ends at the client's `redirect_uri`.
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { browserFetch } from './browser-fetch';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.login-render.ts';
const REDIRECT_URI = 'http://127.0.0.1:9877/oauth/cb';
const CLIENT_ID = 'login-render-client';

async function startAuthorization(baseUrl: string): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: sha256Base64url(generateCodeVerifier()),
    code_challenge_method: 'S256',
    scope: 'read',
    state: 'st-render',
  }).toString();
  return browserFetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

function pageCsp(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
}

async function submit(baseUrl: string, html: string, deskKey: string): Promise<Response> {
  const pendingAuthId = html.match(/name="pending_auth_id" value="([^"]+)"/)?.[1] ?? '';
  return browserFetch(`${baseUrl}/oauth/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(baseUrl).origin },
    body: new URLSearchParams({ pending_auth_id: pendingAuthId, deskKey }).toString(),
  });
}

describe('LOCAL-mode login.render page with its own CSP (#1477)', () => {
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

  it("puts the client's redirect origin in the page's form-action, and sends no CSP header of its own", async () => {
    const res = await startAuthorization(baseUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(pageCsp(await res.text())).toBe("default-src 'none'; form-action 'self' http://127.0.0.1:9877");
  });

  it('ends a POST of the form at the redirect origin the page allows', async () => {
    const html = await (await startAuthorization(baseUrl)).text();

    const res = await submit(baseUrl, html, 'desk-test-key');

    expect([302, 303]).toContain(res.status);
    const location = new URL(res.headers.get('location') ?? baseUrl);
    expect(pageCsp(html)).toContain(location.origin);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('st-render');
  });

  it('keeps the redirect origin on the page shown again after a failed sign-in', async () => {
    const html = await (await startAuthorization(baseUrl)).text();

    const res = await submit(baseUrl, html, 'wrong-key');

    expect(res.status).toBe(200);
    const retry = await res.text();
    expect(retry).toContain('Unknown desk key');
    expect(pageCsp(retry)).toBe("default-src 'none'; form-action 'self' http://127.0.0.1:9877");
  });
});
