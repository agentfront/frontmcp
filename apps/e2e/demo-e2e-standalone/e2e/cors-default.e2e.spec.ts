/**
 * E2E: what the no-CORS default actually does, over real HTTP.
 *
 * BREAKING in v1.7.0 (BC-034): omitting `http.cors` used to install permissive
 * CORS (`origin: true`); it now installs no CORS middleware at all.
 *
 * CORS is a browser rule, not server-side access control: the response carries no
 * `Access-Control-Allow-Origin` header, which is what makes a browser refuse to
 * let the calling page read it. Refusing the request is a separate check: this
 * server binds loopback, where a request from another origin is refused outright
 * (proposal 1.7) — a request with no `Origin` is still served.
 *
 * The browser half of that (refusing the read) is enforced by the browser vendor
 * from the absence of the header, so driving a real browser here would test
 * Chromium rather than FrontMCP. The header presence/absence below is the part
 * FrontMCP owns, and it is what the browser decides on.
 */
import { expect, test } from '@frontmcp/testing';

const CROSS_ORIGIN = 'https://evil.example.com';

test.describe('CORS default: no headers', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('refuses a cross-origin request on a loopback bind, and sends no CORS headers', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      headers: { Origin: CROSS_ORIGIN },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  test('serves a request with no Origin and sends no CORS headers', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('does not answer a preflight with CORS headers', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      method: 'OPTIONS',
      headers: { Origin: CROSS_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
