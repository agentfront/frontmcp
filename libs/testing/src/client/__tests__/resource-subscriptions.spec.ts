/**
 * `mcp.resources.subscribe()` / `unsubscribe()` send the requests, and a refusal reaches the spec as an error.
 */
import { McpTestClient } from '../mcp-test-client';

interface JsonRpcRequestBody {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

function stubFetch(refuse: Set<string>): JsonRpcRequestBody[] {
  const requests: JsonRpcRequestBody[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as JsonRpcRequestBody;
    requests.push(body);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const answer =
      body.method === 'initialize'
        ? {
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { resources: { subscribe: true } },
              serverInfo: { name: 'test', version: '1.0.0' },
            },
          }
        : refuse.has(String(body.params?.['uri']))
          ? { error: { code: -32003, message: 'Access denied' } }
          : { result: {} };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...answer }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return requests;
}

describe('McpTestClient resource subscriptions', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('subscribes and unsubscribes with the resource URI', async () => {
    const requests = stubFetch(new Set());
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true }).build();
    await client.connect();

    await client.resources.subscribe('board://status');
    await client.resources.unsubscribe('board://status');

    expect(requests.filter((request) => request.method.startsWith('resources/'))).toEqual([
      expect.objectContaining({ method: 'resources/subscribe', params: { uri: 'board://status' } }),
      expect.objectContaining({ method: 'resources/unsubscribe', params: { uri: 'board://status' } }),
    ]);
  });

  it('throws the server error when the subscription is refused', async () => {
    stubFetch(new Set(['admin://board']));
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true }).build();
    await client.connect();

    await expect(client.resources.subscribe('admin://board')).rejects.toThrow('Access denied');
    await expect(client.resources.unsubscribe('admin://board')).rejects.toThrow('Access denied');
  });
});
