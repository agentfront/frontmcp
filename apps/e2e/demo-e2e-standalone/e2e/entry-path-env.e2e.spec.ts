/**
 * E2E regression for #446 — the MCP endpoint is mounted at the configured HTTP path.
 *
 * `frontmcp dev` propagates the configured `transport.http.path` to the spawned
 * server via the `FRONTMCP_HTTP_ENTRY_PATH` env var; the SDK's
 * `httpOptionsSchema.entryPath` default reads it. This pins the SDK end of that
 * contract: with the env set, the streamable-HTTP MCP endpoint is served at
 * `/mcp` (where the generated `clients.*.url` points), NOT at `/`. Before the fix
 * the server always mounted at `/`, so a client pointed at `/mcp` 404'd.
 *
 * Uses `TestServer` directly (not the `test.use` fixture) because that fixture
 * eagerly connects an MCP client at the ROOT path — which, correctly, no longer
 * serves MCP once the endpoint moves to `/mcp`. A successful `initialize` mints
 * an `mcp-session-id` response header, which marks the real MCP endpoint.
 */
import * as path from 'node:path';

import { TestServer } from '@frontmcp/testing';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');
const INITIALIZE = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'entrypath-e2e', version: '0.0.0' },
  },
};

async function postInitialize(url: string): Promise<{ status: number; sessionId: string | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(INITIALIZE),
  });
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') };
}

describe('MCP endpoint honors FRONTMCP_HTTP_ENTRY_PATH (#446)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      cwd: WORKSPACE_ROOT,
      env: { FRONTMCP_HTTP_ENTRY_PATH: '/mcp' },
    });
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
  });

  it('serves the MCP endpoint at the configured /mcp path', async () => {
    const res = await postInitialize(`${server.info.baseUrl}/mcp`);
    expect(res.status).toBe(200);
    expect(res.sessionId).toBeTruthy();
  });

  it('no longer serves the MCP endpoint at / (the old default)', async () => {
    const res = await postInitialize(`${server.info.baseUrl}/`);
    // The MCP endpoint moved to /mcp — the root no longer mints a session.
    expect(res.sessionId).toBeFalsy();
  });
});
