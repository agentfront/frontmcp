/**
 * E2E: the CORS opt-in — the counterpart to cors-default.e2e.spec.ts.
 *
 * Lives in its own file because the test fixture starts one server per spec
 * file, so a CORS-configured server and a CORS-less one cannot share one.
 *
 * The contrast is the point: a configured origin gets an
 * `Access-Control-Allow-Origin` header and is served. An unconfigured one is
 * refused, because this server binds loopback and checks `Origin` there
 * (proposal 1.7); the CORS list is what admits the configured one.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('CORS opt-in: explicit origin', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-cors.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('echoes the allow-origin header for a configured origin', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      headers: { Origin: 'https://allowed.example.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
  });

  test('refuses an origin that is not on the list, and never echoes it', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      headers: { Origin: 'https://evil.example.com' },
    });

    expect(res.status).toBe(403);
    // A fixed `origin` string is sent on every response, so the header IS present; what matters is
    // that it names the allowed origin, never the caller's. The browser compares the two and
    // refuses the read on a mismatch.
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example.com');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
  });
});
