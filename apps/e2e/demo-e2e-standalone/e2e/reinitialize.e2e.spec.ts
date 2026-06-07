/**
 * E2E regression for #474 — Streamable-HTTP re-initialize must succeed.
 *
 * When a client re-sends `initialize` on a live, already-initialized session
 * (a dev-server restart that recreated the session, a reconnect, or a retried
 * handshake — with NO explicit DELETE in between), the server must perform an
 * idempotent re-initialization and return a fresh, successful result.
 *
 * Before the fix the reset path only ran when the session had been explicitly
 * DELETE-terminated in the current process, so this path fell through to the
 * MCP SDK and dead-ended with `400 / -32600 "Server already initialized"`
 * (returned with `id: null`), trapping the client with no way forward.
 *
 * The standalone server runs in public mode, so re-sending the `mcp-session-id`
 * header makes the server reuse the same session id and route to the same
 * in-memory, initialized transport — exactly the condition that triggered #474.
 */
import { expect, test } from '@frontmcp/testing';

const INITIALIZE_BODY = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'reinit-e2e', version: '0.0.0' },
  },
};

interface JsonRpcMessage {
  result?: unknown;
  error?: { code?: number; message?: string };
  id?: unknown;
}

interface InitResult {
  status: number;
  sessionId: string | null;
  message: JsonRpcMessage | undefined;
}

/**
 * Initialize responses come back as SSE (the SDK leaves `enableJsonResponse`
 * off), while the `-32600` rejection is a plain JSON 400. Parse whichever shape
 * arrived so the assertions can read `result` / `error` uniformly.
 */
function parseJsonRpc(contentType: string, body: string): JsonRpcMessage | undefined {
  if (contentType.includes('text/event-stream')) {
    const dataLine = body.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) return undefined;
    try {
      return JSON.parse(dataLine.slice('data:'.length).trim()) as JsonRpcMessage;
    } catch {
      return undefined;
    }
  }
  try {
    return JSON.parse(body) as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

async function postInitialize(endpoint: string, sessionId?: string): Promise<InitResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(INITIALIZE_BODY),
  });
  const text = await res.text();
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id'),
    message: parseJsonRpc(res.headers.get('content-type') ?? '', text),
  };
}

test.describe('Streamable-HTTP re-initialize (#474)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('re-initialize on a live session returns a fresh result, not -32600', async ({ server }) => {
    const endpoint = server.info.baseUrl;

    // 1) First initialize — creates the session and marks the transport initialized.
    const first = await postInitialize(endpoint);
    expect(first.status).toBe(200);
    expect(first.sessionId).toBeTruthy();
    expect(first.message?.result).toBeDefined();

    const sessionId = first.sessionId as string;

    // 2) Re-send initialize WITH the same mcp-session-id and NO DELETE in between.
    //    This routes to the same live, initialized transport — the #474 trigger.
    const second = await postInitialize(endpoint, sessionId);

    expect(second.status).toBe(200);
    expect(second.message?.error).toBeUndefined();
    expect(second.message?.result).toBeDefined();
  });

  test('re-initialize never surfaces "Server already initialized"', async ({ server }) => {
    const endpoint = server.info.baseUrl;

    const first = await postInitialize(endpoint);
    expect(first.sessionId).toBeTruthy();
    const sessionId = first.sessionId as string;

    const second = await postInitialize(endpoint, sessionId);

    expect(second.status).not.toBe(400);
    expect(second.message?.error?.code).not.toBe(-32600);
    expect(JSON.stringify(second.message ?? {})).not.toMatch(/Server already initialized/i);
  });

  test('the session remains usable after re-initialization', async ({ server }) => {
    const endpoint = server.info.baseUrl;

    const first = await postInitialize(endpoint);
    const sessionId = first.sessionId as string;

    // Re-initialize, then drive a normal request on the same session id.
    await postInitialize(endpoint, sessionId);

    const listRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });

    // A trapped/poisoned session would 404 ("session expired") or error here.
    expect(listRes.status).toBe(200);
    const listMessage = parseJsonRpc(listRes.headers.get('content-type') ?? '', await listRes.text());
    expect(listMessage?.error).toBeUndefined();
    expect(listMessage?.result).toBeDefined();
  });
});
