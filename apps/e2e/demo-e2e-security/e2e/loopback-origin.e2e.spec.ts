/**
 * Proposal 1.7: a loopback server refuses a request from another site's page. The browser sends that
 * page's `Origin`; the `Host` is a loopback name, so the Host check alone let it through. A request
 * with no `Origin` (CLI and agent clients) and one from the server's own origin are still served.
 */
import * as path from 'node:path';

import { expect, TestServer } from '@frontmcp/testing';

// Run from the app directory, whose tsconfig resolves @frontmcp/sdk to its source rather than a build.
const SERVER = { command: 'npx tsx src/loopback-origin.main.ts', cwd: path.join(__dirname, '..') };

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'origin-e2e', version: '1.0' } },
});

function initialize(server: TestServer, origin?: string): Promise<Response> {
  return fetch(`${server.info.baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(origin ? { Origin: origin } : {}),
    },
    body: INITIALIZE,
  });
}

describe('Origin check on a loopback bind', () => {
  let derived: TestServer;
  let explicit: TestServer;

  beforeAll(async () => {
    derived = await TestServer.start({ ...SERVER, project: 'demo-e2e-security', startupTimeout: 30_000 });
    explicit = await TestServer.start({
      ...SERVER,
      project: 'demo-e2e-security',
      env: { ALLOWED_ORIGINS: 'https://app.example.com' },
      startupTimeout: 30_000,
    });
  }, 90_000);

  afterAll(async () => {
    await derived?.stop();
    await explicit?.stop();
  });

  it('refuses a cross-origin POST before it opens a session', async () => {
    const res = await initialize(derived, 'https://evil.example');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden', message: 'Invalid Origin header' });
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('serves a request with no Origin', async () => {
    const res = await initialize(derived);

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('serves a request from its own origin', async () => {
    const res = await initialize(derived, `http://localhost:${derived.info.port}`);

    expect(res.status).toBe(200);
  });

  it('lets an explicit allowedOrigins decide instead', async () => {
    expect((await initialize(explicit, 'https://app.example.com')).status).toBe(200);
    expect((await initialize(explicit, `http://localhost:${explicit.info.port}`)).status).toBe(403);
    expect((await initialize(explicit)).status).toBe(200);
  });
});
