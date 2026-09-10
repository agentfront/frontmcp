/**
 * E2E: what the no-CORS default actually does, over real HTTP.
 *
 * BREAKING in v1.7.0 (BC-034): omitting `http.cors` used to install permissive
 * CORS (`origin: true`); it now installs no CORS middleware at all.
 *
 * The docs make a claim that is easy to get backwards, so it is pinned here: a
 * cross-origin request is still DELIVERED and served normally — the server does
 * not reject it — and the response simply carries no `Access-Control-Allow-Origin`
 * header, which is what makes a browser refuse to let the calling page read it.
 * CORS is a browser rule, not server-side access control.
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

  test('delivers and serves a cross-origin request, but sends no CORS headers', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      headers: { Origin: CROSS_ORIGIN },
    });

    // Delivered and served — the server does not reject cross-origin callers.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    // ...but nothing tells the browser the calling page may read it.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  test('does not answer a preflight with CORS headers', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      method: 'OPTIONS',
      headers: { Origin: CROSS_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
