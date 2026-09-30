/**
 * `mcp.tools.list()` and its siblings return every page, not just the first.
 *
 * A FrontMCP server pages `tools/list` (40 per page by default), so a spec for
 * a server with more tools than that used to see only the first page and fail
 * to find the rest.
 */
import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3003';

interface JsonRpcRequestBody {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

/** Stub `fetch`, answering `initialize` and handing every list request to `onList`. */
function stubFetch(onList: (method: string, params: Record<string, unknown>) => Record<string, unknown>): {
  requests: JsonRpcRequestBody[];
} {
  const requests: JsonRpcRequestBody[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as JsonRpcRequestBody;
    requests.push(body);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'test', version: '1.0.0' },
          }
        : onList(body.method, body.params ?? {});
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { requests };
}

function tool(name: string) {
  return { name, inputSchema: { type: 'object' } };
}

async function connectedClient(): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
  await client.connect();
  return client;
}

describe('McpTestClient list pagination', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('concatenates every page of tools/list', async () => {
    const { requests } = stubFetch((_method, params) =>
      params['cursor'] === 'page-2' ? { tools: [tool('c')] } : { tools: [tool('a'), tool('b')], nextCursor: 'page-2' },
    );
    const client = await connectedClient();

    const tools = await client.tools.list();

    expect(tools.map((t) => t.name)).toEqual(['a', 'b', 'c']);
    const listRequests = requests.filter((r) => r.method === 'tools/list');
    expect(listRequests.map((r) => r.params)).toEqual([{}, { cursor: 'page-2' }]);
  });

  it('pages resources, resource templates and prompts the same way', async () => {
    stubFetch((method, params) => {
      const second = params['cursor'] === 'next';
      switch (method) {
        case 'resources/list':
          return second
            ? { resources: [{ uri: 'file://b', name: 'b' }] }
            : { resources: [{ uri: 'file://a', name: 'a' }], nextCursor: 'next' };
        case 'resources/templates/list':
          return second
            ? { resourceTemplates: [{ uriTemplate: 'file://{b}', name: 'b' }] }
            : { resourceTemplates: [{ uriTemplate: 'file://{a}', name: 'a' }], nextCursor: 'next' };
        case 'prompts/list':
          return second ? { prompts: [{ name: 'b' }] } : { prompts: [{ name: 'a' }], nextCursor: 'next' };
        default:
          throw new Error(`unexpected ${method}`);
      }
    });
    const client = await connectedClient();

    expect((await client.resources.list()).map((r) => r.name)).toEqual(['a', 'b']);
    expect((await client.resources.listTemplates()).map((r) => r.name)).toEqual(['a', 'b']);
    expect((await client.prompts.list()).map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('throws when the server hands back a cursor it already returned', async () => {
    stubFetch(() => ({ tools: [tool('a')], nextCursor: 'stuck' }));
    const client = await connectedClient();

    await expect(client.tools.list()).rejects.toThrow(/tools\/list returned the cursor "stuck" twice/);
  });

  it('stops at the page cap instead of looping forever', async () => {
    let page = 0;
    stubFetch(() => ({ tools: [tool(`t${page}`)], nextCursor: `cursor-${++page}` }));
    const client = await connectedClient();

    await expect(client.tools.list()).rejects.toThrow(/tools\/list did not finish within \d+ pages/);
  });
});
