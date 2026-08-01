/**
 * Removed methods, removed HTTP verbs, and renumbered error codes.
 *
 * 2026-07-28 removes `ping`, `logging/setLevel`, `notifications/roots/list_changed`,
 * `resources/subscribe`, `resources/unsubscribe`, and `initialize`; it also
 * moves resource-not-found from `-32002` to `-32602`.
 */
import { expect, test } from '@frontmcp/testing';

import { INVALID_PARAMS, mcp2026Fetch, METHOD_NOT_FOUND, PROTOCOL_2026 } from './helpers/mcp-2026-client';

const REMOVED_METHODS = [
  'ping',
  'logging/setLevel',
  'resources/subscribe',
  'resources/unsubscribe',
  'initialize',
  'tasks/result',
  'tasks/list',
];

test.describe('protocol 2026-07-28 — removals and error codes', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-2026/src/main.ts',
    project: 'demo-e2e-protocol-2026',
    publicMode: true,
  });

  for (const [index, method] of REMOVED_METHODS.entries()) {
    test(`${method} is gone — 404 + -32601`, async ({ server }) => {
      const res = await mcp2026Fetch(server.info.baseUrl, {
        method,
        id: 600 + index,
        params: method === 'resources/subscribe' ? { uri: 'proto://config' } : {},
      });

      // Spec: an unimplemented RPC method MUST answer `404 Not Found` with a
      // JSON-RPC `-32601`, so clients can tell it apart from a legacy 404.
      expect(res.status).toBe(404);
      expect(res.json().error.code).toBe(METHOD_NOT_FOUND);
    });
  }

  test('resource not found now returns -32602, not -32002', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 700,
      params: { uri: 'proto://does-not-exist' },
    });

    const { error } = res.json();
    expect(error).toBeDefined();
    expect(error.code).toBe(INVALID_PARAMS);
    expect(error.code).not.toBe(-32002);
  });

  test('HTTP GET on the MCP endpoint returns 405', async ({ server }) => {
    const res = await fetch(server.info.baseUrl, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026,
      },
    });

    expect(res.status).toBe(405);
  });

  test('HTTP DELETE on the MCP endpoint returns 405', async ({ server }) => {
    const res = await fetch(server.info.baseUrl, {
      method: 'DELETE',
      headers: {
        'mcp-protocol-version': PROTOCOL_2026,
        'mcp-session-id': 'anything',
      },
    });

    expect(res.status).toBe(405);
  });

  test('an unknown method still returns 404 + -32601', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, { method: 'totally/unknown', id: 701 });

    expect(res.status).toBe(404);
    expect(res.json().error.code).toBe(METHOD_NOT_FOUND);
  });

  test('a JSON-RPC notification POST is accepted with 202 and no body', async ({ server }) => {
    const res = await fetch(server.info.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026,
        'mcp-method': 'notifications/cancelled',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 1, reason: 'user cancelled' },
      }),
    });

    expect(res.status).toBe(202);
    expect((await res.text()).trim()).toBe('');
  });

  test('does not emit notifications/message when no logLevel was requested', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 702,
      params: { name: 'echo', arguments: { message: 'quiet' } },
      accept: 'text/event-stream',
    });

    expect(res.status).toBe(200);
    // Whether the server answers with JSON or SSE, no log notification may
    // appear for a request that did not opt in via `_meta` logLevel.
    expect(res.text).not.toContain('notifications/message');
  });
});
