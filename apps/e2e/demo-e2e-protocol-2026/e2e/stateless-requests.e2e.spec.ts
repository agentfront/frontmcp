/**
 * Statelessness — SEP-2575.
 *
 * 2026-07-28 removes the `initialize` / `notifications/initialized` handshake
 * and protocol-level sessions entirely. Every request stands alone, carrying
 * its own protocol version and client capabilities in `_meta`.
 */
import { expect, test } from '@frontmcp/testing';

import {
  mcp2026Fetch,
  META_SERVER_INFO,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type ListedTool,
  type Mcp2026Response,
} from './helpers/mcp-2026-client';

test.describe('protocol 2026-07-28 — stateless requests', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-2026/src/main.ts',
    project: 'demo-e2e-protocol-2026',
    publicMode: true,
  });

  test('tools/list works with no initialize and no session', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, { method: 'tools/list', id: 1 });

    expect(res.status).toBe(200);
    const { result, error } = res.json();
    expect(error).toBeUndefined();
    expect((result.tools as ListedTool[]).map((t) => t.name)).toEqual(
      expect.arrayContaining(['echo', 'region-query', 'confirm']),
    );
  });

  test('never mints an Mcp-Session-Id', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, { method: 'tools/list', id: 2 });

    // Sessions were removed from the transport — the server must not mint or
    // echo one, even if a client sends it.
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  test('ignores an Mcp-Session-Id sent by a confused client', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 3,
      headers: { 'mcp-session-id': 'bogus-session-value' },
    });

    expect(res.status).toBe(200);
    expect(res.json().error).toBeUndefined();
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  test('ignores Last-Event-ID — streams are no longer resumable', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 4,
      headers: { 'last-event-id': '42' },
    });

    expect(res.status).toBe(200);
    expect(res.json().error).toBeUndefined();
  });

  test('tools/call succeeds cold, with no prior request of any kind', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 5,
      params: { name: 'echo', arguments: { message: 'stateless' } },
    });

    expect(res.status).toBe(200);
    const { result } = res.json();
    expect(result.resultType).toBe('complete');
    expect(JSON.stringify(result.content)).toContain('stateless');
  });

  test('every result carries resultType "complete"', async ({ server }) => {
    const calls: { method: string; params?: Record<string, unknown> }[] = [
      { method: 'tools/list' },
      { method: 'resources/list' },
      { method: 'resources/templates/list' },
      { method: 'prompts/list' },
      { method: 'resources/read', params: { uri: 'proto://config' } },
      { method: 'prompts/get', params: { name: 'greeting', arguments: { subject: 'ada' } } },
      { method: 'tools/call', params: { name: 'echo', arguments: { message: 'x' } } },
    ];

    const seen: Record<string, unknown> = {};
    for (const [i, call] of calls.entries()) {
      const res = await mcp2026Fetch(server.info.baseUrl, { ...call, id: 100 + i });
      const body = res.json();
      seen[call.method] = body.error ?? body.result?.resultType;
    }

    // Asserted as one object so a failure names every offending method at once
    // rather than stopping at the first.
    expect(seen).toEqual({
      'tools/list': 'complete',
      'resources/list': 'complete',
      'resources/templates/list': 'complete',
      'prompts/list': 'complete',
      'resources/read': 'complete',
      'prompts/get': 'complete',
      'tools/call': 'complete',
    });
  });

  test('every result carries serverInfo in _meta', async ({ server }) => {
    const methods = ['tools/list', 'resources/list', 'prompts/list'];
    const seen: Record<string, unknown> = {};
    for (const [i, method] of methods.entries()) {
      const res = await mcp2026Fetch(server.info.baseUrl, { method, id: 200 + i });
      seen[method] = res.json().result?._meta?.[META_SERVER_INFO];
    }

    for (const method of methods) {
      expect(seen[method]).toMatchObject({ name: expect.any(String), version: expect.any(String) });
    }
  });

  test('does not infer capabilities from a previous request', async ({ server }) => {
    // Request 1 declares elicitation support; request 2 declares none. The
    // server MUST NOT carry the first declaration over to the second.
    await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 6,
      clientCapabilities: { elicitation: { form: {} } },
    });

    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 7,
      params: { name: 'confirm', arguments: { action: 'deploy' } },
      clientCapabilities: {},
    });

    const { result, error } = res.json();
    // With no elicitation capability declared the server must either refuse with
    // -32021 or ask via MRTR. A plain `complete` result would mean the earlier
    // request's declaration leaked into this one.
    const outcome = error ? `error:${error.code}` : `result:${result?.resultType}`;
    expect([`error:${MISSING_REQUIRED_CLIENT_CAPABILITY}`, 'result:input_required']).toContain(outcome);
  });

  test('returns tools/list in a deterministic order across calls', async ({ server }) => {
    const first = await mcp2026Fetch(server.info.baseUrl, { method: 'tools/list', id: 8 });
    const second = await mcp2026Fetch(server.info.baseUrl, { method: 'tools/list', id: 9 });

    const names = (r: Mcp2026Response) => (r.json().result.tools as ListedTool[]).map((t) => t.name);
    expect(names(first)).toEqual(names(second));
  });
});
