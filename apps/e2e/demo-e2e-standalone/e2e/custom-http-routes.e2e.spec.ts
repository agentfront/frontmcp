/**
 * E2E Tests for first-class custom HTTP routes (issue #465) — public-mode server.
 *
 * Verifies, over real HTTP, that `http.routes` entries:
 *  - are reachable on the same listener as the MCP endpoint (public route),
 *  - can override Content-Type (HTML handler — the adapter defaults to JSON),
 *  - run the `session:verify` flow when `auth: true` (public auth mode mints an
 *    anonymous session, so the handler runs and can read req.authSession).
 *
 * The 401 path (auth:true under a non-anonymous auth mode) lives in
 * custom-http-routes-auth.e2e.spec.ts — the test fixture starts one server per
 * file, so the two auth modes must be in separate specs.
 *
 * Collision rejection is covered by the unit suite
 * (libs/sdk/src/server/__tests__/custom-routes.helper.spec.ts).
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Custom HTTP Routes E2E (public mode)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('public GET route returns JSON on the MCP listener', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; route?: string };
    expect(body.ok).toBe(true);
    expect(body.route).toBe('custom-ping');
  });

  test('handler can override Content-Type to serve HTML', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    const text = await res.text();
    expect(text).toContain('custom-page');
  });

  test('auth:true route runs handler with an anonymous session in public mode', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/whoami`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; hasAuthSession?: boolean };
    expect(body.ok).toBe(true);
    expect(body.hasAuthSession).toBe(true);
  });

  test('POST route reads and validates a JSON body (connect-env pattern)', async ({ server }) => {
    // The issue's reported use case: a POST endpoint that validates a
    // user-entered secret server-side. The shared express.json() middleware
    // parses req.body, so the handler can read it directly.
    const accepted = await fetch(`${server.info.baseUrl}/custom/connect-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'sk-valid' }),
    });
    expect(accepted.status).toBe(200);
    const okBody = (await accepted.json()) as { ok?: boolean; connected?: boolean };
    expect(okBody.ok).toBe(true);
    expect(okBody.connected).toBe(true);

    const rejected = await fetch(`${server.info.baseUrl}/custom/connect-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong' }),
    });
    expect(rejected.status).toBe(400);
    const badBody = (await rejected.json()) as { ok?: boolean; error?: string };
    expect(badBody.ok).toBe(false);
  });

  test('unmatched custom path still falls through to 404', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
