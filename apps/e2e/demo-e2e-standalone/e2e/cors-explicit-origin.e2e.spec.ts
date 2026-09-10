/**
 * E2E: the CORS opt-in — the counterpart to cors-default.e2e.spec.ts.
 *
 * Lives in its own file because the test fixture starts one server per spec
 * file, so a CORS-configured server and a CORS-less one cannot share one.
 *
 * The contrast is the point: a configured origin gets an
 * `Access-Control-Allow-Origin` header, an unconfigured one does not — and
 * neither is REJECTED. CORS decides what a browser may read, never what the
 * server will answer.
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

  test('never echoes an origin that is not on the list', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/ping`, {
      headers: { Origin: 'https://evil.example.com' },
    });

    // Still delivered — CORS never blocks the request, only the browser-side read.
    expect(res.status).toBe(200);
    // A fixed `origin` string is sent on every response, so the header IS present; what matters is
    // that it names the allowed origin, never the caller's. The browser compares the two and
    // refuses the read on a mismatch.
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example.com');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
  });
});
