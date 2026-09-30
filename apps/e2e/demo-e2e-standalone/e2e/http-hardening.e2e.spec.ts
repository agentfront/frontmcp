/**
 * E2E: security headers and the request body limit, over real HTTP (#646).
 *
 * - `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` are on by
 *   default, `X-Powered-By` is never sent, and `http.securityHeaders` adds HSTS
 *   and custom headers.
 * - A body over `http.bodyLimit` gets HTTP 413 with a JSON-RPC envelope, and a
 *   small body still goes through.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('HTTP hardening', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-hardening.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('sends security headers and no X-Powered-By on the health probe', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/healthz`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  test('sends the same headers on the MCP endpoint', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  test('rejects a body over http.bodyLimit with 413 and a JSON-RPC envelope', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/echo-size`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(4096) }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: '2.0', error: { message: 'Payload Too Large' } });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('accepts a body under http.bodyLimit', async ({ server }) => {
    const res = await fetch(`${server.info.baseUrl}/custom/echo-size`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, keys: 1 });
  });
});
