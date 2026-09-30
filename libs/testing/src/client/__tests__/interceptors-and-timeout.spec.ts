/**
 * Errors from `mcp.intercept.failMethod()` reject every public API (not just `list()`),
 * and a client timeout is reported as a timeout even when fetch throws a cross-realm AbortError.
 */
import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3004';

interface JsonRpcRequestBody {
  id?: number;
  method: string;
}

function stubFetch(onRequest: (body: JsonRpcRequestBody, init?: RequestInit) => Promise<Response> | Response): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as JsonRpcRequestBody;
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'test', version: '1.0.0' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return onRequest(body, init);
  }) as typeof fetch;
}

async function connectedClient(timeout?: number): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true, timeout }).build();
  await client.connect();
  return client;
}

describe('McpTestClient interceptors', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('failMethod makes resources.read() reject with the injected message', async () => {
    stubFetch((body) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { contents: [] } })));
    const client = await connectedClient();
    const remove = client.intercept.failMethod('resources/read', 'Simulated storage failure');

    await expect(client.resources.read('data://x')).rejects.toThrow('Simulated storage failure');

    remove();
    await expect(client.resources.read('data://x')).resolves.toBeDefined();
  });

  it('failMethod makes tools.call() and tools.list() reject', async () => {
    stubFetch((body) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } })));
    const client = await connectedClient();
    client.intercept.failMethod('tools/call', 'call blocked');
    client.intercept.failMethod('tools/list', 'list blocked');

    await expect(client.tools.call('x', {})).rejects.toThrow('call blocked');
    await expect(client.tools.list()).rejects.toThrow('list blocked');
  });
});

describe('McpTestClient timeout', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reports a timeout when fetch rejects with an AbortError that is not instanceof Error', async () => {
    stubFetch((_body, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          // What undici does under Jest: an error object from another realm
          reject(
            Object.create(null, { name: { value: 'AbortError' }, message: { value: 'This operation was aborted' } }),
          );
        });
      });
    });
    const client = await connectedClient(50);

    const result = await client.tools.call('slow', {});

    expect(result.isError).toBe(true);
    expect(result.error?.message).toContain('timeout after 50ms');
  });

  it('keeps the message of a thrown non-Error object instead of "Unknown error"', async () => {
    stubFetch(() => Promise.reject({ message: 'socket hang up' }));
    const client = await connectedClient();

    const result = await client.tools.call('x', {});

    expect(result.error?.message).toBe('socket hang up');
  });
});
