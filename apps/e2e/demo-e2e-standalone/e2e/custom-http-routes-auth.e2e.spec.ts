/**
 * E2E Tests for custom HTTP routes `auth: true` under a non-anonymous auth mode
 * (issue #465). Separate spec file from the public-mode tests because the test
 * fixture starts one server per file.
 *
 * The server (main-auth-route.ts) uses local OAuth with
 * `allowDefaultPublic: false` — no anonymous fallback — so an unauthenticated
 * request to an `auth: true` route short-circuits with HTTP 401 +
 * WWW-Authenticate, exactly like the MCP endpoint would.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Custom HTTP Routes E2E (local auth, no anonymous fallback)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-auth-route.ts',
    project: 'demo-e2e-standalone',
  });

  test('public route is reachable without auth', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/open/ping`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test('auth:true route returns 401 + WWW-Authenticate when unauthenticated', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/secure/whoami`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeTruthy();
  });
});
