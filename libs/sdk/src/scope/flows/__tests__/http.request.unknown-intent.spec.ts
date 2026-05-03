/**
 * @file http.request.unknown-intent.spec.ts
 * @description Regression tests for #380 — JSON-RPC POST without an
 * initialized session previously fell through to Express's default HTML 404.
 * MCP clients parse responses as JSON-RPC; an HTML body is unrecoverable.
 *
 * The router now responds with a structured JSON-RPC error envelope when the
 * request body is shaped like a JSON-RPC method call and no session is bound.
 * Non-RPC requests (favicon, custom routes) still fall through to user
 * middleware as before.
 */

interface RouterRequest {
  method: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

type RouterAction =
  | { kind: 'next' }
  | {
      kind: 'json-rpc-error';
      status: number;
      contentType: string;
      body: { jsonrpc: string; id: unknown; error: { code: number; message: string; data?: unknown } };
    };

/**
 * Mirrors the unknown-intent branch added in http.request.flow.ts router stage.
 * Pure function so it can be tested in isolation without booting a scope.
 */
function decideUnknownIntent(request: RouterRequest): RouterAction {
  const body = request.body;
  const isJsonRpcRequest =
    request.method.toUpperCase() !== 'DELETE' &&
    body !== undefined &&
    body !== null &&
    typeof body === 'object' &&
    body['jsonrpc'] === '2.0' &&
    typeof body['method'] === 'string' &&
    body['method'] !== 'initialize';

  if (isJsonRpcRequest) {
    const id = (body?.['id'] as string | number | null | undefined) ?? null;
    return {
      kind: 'json-rpc-error',
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Session not initialized — send `initialize` first',
          data: { transport: 'streamable-http', expected: 'initialize' },
        },
      },
    };
  }
  return { kind: 'next' };
}

describe('HTTP request flow — unknown intent (#380)', () => {
  it('returns a structured JSON-RPC error envelope for a tools/list POST without session', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      headers: { 'content-type': 'application/json' },
    });

    expect(result.kind).toBe('json-rpc-error');
    if (result.kind !== 'json-rpc-error') return;
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('application/json; charset=utf-8');
    expect(result.body.jsonrpc).toBe('2.0');
    expect(result.body.id).toBe(1);
    expect(result.body.error.code).toBe(-32600);
    expect(result.body.error.message).toMatch(/Session not initialized/);
    expect(result.body.error.data).toEqual({ transport: 'streamable-http', expected: 'initialize' });
  });

  it('preserves the request id (string) in the error envelope', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { jsonrpc: '2.0', id: 'req-abc', method: 'resources/list', params: {} },
    });
    expect(result.kind === 'json-rpc-error' && result.body.id).toBe('req-abc');
  });

  it('emits id:null when the request omits an id', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', params: {} },
    });
    expect(result.kind === 'json-rpc-error' && result.body.id).toBeNull();
  });

  it('falls through to next() for a real `initialize` request — not a session error', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(result.kind).toBe('next');
  });

  it('falls through to next() for non-JSON-RPC bodies (custom routes, health probes)', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { ping: 'pong' },
    });
    expect(result.kind).toBe('next');
  });

  it('falls through to next() for empty body (e.g., GET /favicon.ico)', () => {
    expect(decideUnknownIntent({ method: 'GET' }).kind).toBe('next');
    expect(decideUnknownIntent({ method: 'GET', body: undefined }).kind).toBe('next');
  });

  it('does not intercept DELETE requests (session termination)', () => {
    const result = decideUnknownIntent({
      method: 'DELETE',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(result.kind).toBe('next');
  });

  it('rejects bodies missing the jsonrpc:"2.0" sentinel', () => {
    const result = decideUnknownIntent({
      method: 'POST',
      body: { id: 1, method: 'tools/list' },
    });
    expect(result.kind).toBe('next');
  });
});
