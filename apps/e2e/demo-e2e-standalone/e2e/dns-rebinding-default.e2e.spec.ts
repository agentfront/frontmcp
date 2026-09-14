/**
 * E2E regression guard for GHSA-mc9g-v2cp-vfff — DNS-rebinding protection was
 * off by default on the MCP HTTP endpoint.
 *
 * A malicious page that controls a domain can rebind it to 127.0.0.1 and then
 * talk to a loopback-bound MCP server as a same-origin service. Binding to
 * loopback is no defence — loopback is the *destination* of the rebind — and
 * neither is CORS, because after the rebind the browser genuinely considers the
 * request same-origin. The only server-side defence is validating that the
 * `Host` the request names is one this server actually answers to.
 *
 * BC-035 (v1.7.2): `security.dnsRebindingProtection` now defaults to ON, with
 * `allowedHosts` derived from the resolved bind address and port.
 *
 * The reachability assertions are deliberately un-skippable: a zero-config
 * server must reject an attacker `Host` and must still serve a legitimate one,
 * including the loopback aliases a local client actually uses.
 */
import * as http from 'node:http';

import { expect, test } from '@frontmcp/testing';

const EVIL_HOST = 'evil.attacker.example';

/**
 * Node's `fetch` silently drops a caller-supplied `Host` header, so it cannot
 * express this attack at all. These tests speak raw HTTP for the same reason
 * the advisory's PoC used curl: the forged `Host` IS the payload.
 */
function rawRequest(
  baseUrl: string,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(opts.path ?? '/', baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Minimal MCP initialize body — the first request a rebound page would make. */
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dns-rebinding-e2e', version: '1.0' },
  },
});

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

test.describe('DNS rebinding protection: on by default', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('rejects an MCP initialize carrying an attacker-controlled Host', async ({ server }) => {
    const res = await rawRequest(server.info.baseUrl, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Host: EVIL_HOST, Origin: `https://${EVIL_HOST}` },
      body: INITIALIZE_BODY,
    });

    expect(res.status).toBe(403);
    // No session may be established for a request the server has already refused.
    expect(res.headers['mcp-session-id']).toBeUndefined();
  });

  test('rejects a spoofed X-Forwarded-Host even when Host itself is valid', async ({ server }) => {
    const res = await rawRequest(server.info.baseUrl, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'X-Forwarded-Host': EVIL_HOST },
      body: INITIALIZE_BODY,
    });

    expect(res.status).toBe(403);
  });

  test('rejects an attacker Host on a custom HTTP route too', async ({ server }) => {
    // Host validation runs at the adapter layer, so every route on the server
    // is covered — not just the MCP endpoint.
    const res = await rawRequest(server.info.baseUrl, {
      path: '/custom/ping',
      headers: { Host: EVIL_HOST },
    });

    expect(res.status).toBe(403);
  });

  test('rejects the attacker Host before buffering the request body', async ({ server }) => {
    // Host validation is installed ahead of the body parsers, so an oversized
    // body from a rebound page is refused rather than read into memory.
    const res = await rawRequest(server.info.baseUrl, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Host: EVIL_HOST },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', pad: 'x'.repeat(5_000_000) }),
    });

    expect(res.status).toBe(403);
    // Not the 413 the body-size limit would produce if parsing ran first.
    expect(res.body).toContain('Invalid Host header');
  });

  test('still serves a request whose Host matches the bound address and port', async ({ server }) => {
    const res = await rawRequest(server.info.baseUrl, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: INITIALIZE_BODY,
    });

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeTruthy();
  });

  test('accepts the loopback aliases a local client actually uses', async ({ server }) => {
    const port = new URL(server.info.baseUrl).port;

    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      const res = await rawRequest(server.info.baseUrl, { path: '/custom/ping', headers: { Host: host } });
      expect({ host, status: res.status }).toEqual({ host, status: 200 });
    }
  });

  test('matches the Host case-insensitively (hostnames are not case-sensitive)', async ({ server }) => {
    const port = new URL(server.info.baseUrl).port;
    const res = await rawRequest(server.info.baseUrl, {
      path: '/custom/ping',
      headers: { Host: `LOCALHOST:${port}` },
    });

    expect(res.status).toBe(200);
  });
});
