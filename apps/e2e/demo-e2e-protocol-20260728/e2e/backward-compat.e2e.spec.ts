/**
 * Backward compatibility.
 *
 * Adding 2026-07-28 must not degrade any earlier revision. The same server
 * endpoint keeps serving the session + `initialize` era exactly as before,
 * selected per-request by the protocol version the client presents.
 */
import { expect, test } from '@frontmcp/testing';

import { parseSseEvents } from './helpers/mcp-stateless-client';

const LEGACY_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

async function legacyInitialize(baseUrl: string, protocolVersion: string) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'legacy-e2e', version: '1.0.0' },
      },
    }),
  });

  const text = await res.text();
  const trimmed = text.trim();
  // The legacy transport answers `initialize` with either plain JSON or an SSE
  // frame (`event: message\ndata: {…}`) depending on the negotiated protocol.
  const isSse = /^(event:|data:|:)/.test(trimmed);
  const payload = isSse ? JSON.parse(parseSseEvents(trimmed).pop() as string) : JSON.parse(trimmed);

  return { res, payload, sessionId: res.headers.get('mcp-session-id') };
}

test.describe('protocol backward compatibility', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('the stock MCP client still connects and lists tools', async ({ mcp }) => {
    expect(mcp.isConnected()).toBe(true);
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('echo');
  });

  test('the stock MCP client still calls tools', async ({ mcp }) => {
    const result = await mcp.tools.call('echo', { message: 'legacy path' });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('legacy path');
  });

  test('the stock MCP client still reads resources and gets prompts', async ({ mcp }) => {
    const resource = await mcp.resources.read('proto://config');
    expect(JSON.stringify(resource)).toContain('protocol-2026');

    const prompt = await mcp.prompts.get('greeting', { subject: 'ada' });
    expect(JSON.stringify(prompt)).toContain('ada');
  });

  for (const version of LEGACY_VERSIONS) {
    test(`initialize still works for ${version}`, async ({ server }) => {
      const { res, payload } = await legacyInitialize(server.info.baseUrl, version);

      expect(res.status).toBe(200);
      expect(payload.error).toBeUndefined();
      expect(payload.result.protocolVersion).toBeDefined();
      expect(payload.result.serverInfo).toBeDefined();
      expect(payload.result.capabilities).toBeDefined();
    });

    test(`${version} results do NOT carry 2026-only fields`, async ({ server }) => {
      const { payload } = await legacyInitialize(server.info.baseUrl, version);

      // `resultType`, `ttlMs` and `cacheScope` are 2026-07-28 additions. Leaking
      // them into an older negotiation could break strict legacy clients.
      expect(payload.result.resultType).toBeUndefined();
      expect(payload.result.ttlMs).toBeUndefined();
      expect(payload.result.cacheScope).toBeUndefined();
    });
  }

  test('legacy initialize still mints an Mcp-Session-Id', async ({ server }) => {
    const { sessionId } = await legacyInitialize(server.info.baseUrl, '2025-06-18');
    expect(sessionId).toBeTruthy();
  });

  test('the legacy HTTP+SSE endpoint still opens a stream', async ({ server }) => {
    // Driven with raw fetch rather than McpTestClient: the test client's `sse`
    // transport is still a stub, so only a direct request actually exercises
    // the server's deprecated-but-supported 2024-11-05 GET /sse endpoint.
    const controller = new AbortController();
    const res = await fetch(`${server.info.baseUrl}/sse`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    try {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // The first frame of the legacy transport is the `endpoint` event that
      // tells the client where to POST its messages.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 10000;
      while (!buffer.includes('event: endpoint') && Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      expect(buffer).toContain('event: endpoint');
    } finally {
      controller.abort();
    }
  });

  test('a legacy client can still use resources/subscribe', async ({ server }) => {
    const { sessionId } = await legacyInitialize(server.info.baseUrl, '2025-06-18');

    const res = await fetch(server.info.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/subscribe',
        params: { uri: 'proto://config' },
      }),
    });

    // The method was removed in 2026-07-28 but MUST remain available to
    // clients that negotiated an earlier revision.
    expect(res.status).not.toBe(404);
  });

  test('a request with no protocol version at all still routes to the legacy path', async ({ server }) => {
    const res = await fetch(server.info.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
      }),
    });

    expect(res.status).toBe(200);
  });
});
