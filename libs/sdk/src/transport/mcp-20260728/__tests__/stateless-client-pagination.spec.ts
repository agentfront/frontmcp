/**
 * The 2026-07-28 client and its remote-proxy adapter follow list pagination.
 *
 * A FrontMCP server pages its lists 40 at a time by default; reading only the
 * first response dropped everything after it.
 */
import { McpStatelessClientAdapter } from '../../../remote-mcp/mcp-stateless-client.adapter';
import { McpStatelessClient } from '../client/mcp-stateless.client';

interface SentRequest {
  method: string;
  params: Record<string, unknown>;
}

/** A fetch that answers each list with two pages, the first carrying `nextCursor: 'page-2'`. */
function pagedFetch(): { fetchImpl: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    const { _meta, ...params } = body.params;
    void _meta;
    sent.push({ method: body.method, params });
    const second = params['cursor'] === 'page-2';
    const pages: Record<string, [Record<string, unknown>, Record<string, unknown>]> = {
      'tools/list': [
        { tools: [{ name: 'a', inputSchema: { type: 'object' } }], nextCursor: 'page-2' },
        { tools: [{ name: 'b', inputSchema: { type: 'object' } }] },
      ],
      'resources/list': [{ resources: [{ uri: 'test://a', name: 'a' }], nextCursor: 'page-2' }, { resources: [] }],
      'prompts/list': [{ prompts: [{ name: 'a' }], nextCursor: 'page-2' }, { prompts: [{ name: 'b' }] }],
      'resources/templates/list': [
        { resourceTemplates: [{ uriTemplate: 'test://a/{id}', name: 'a' }], nextCursor: 'page-2' },
        { resourceTemplates: [{ uriTemplate: 'test://b/{id}', name: 'b' }] },
      ],
    };
    const result = pages[body.method]?.[second ? 1 : 0] ?? {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

describe('McpStatelessClient — list pagination', () => {
  it('listTools returns every page', async () => {
    const { fetchImpl, sent } = pagedFetch();
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl });

    const tools = await client.listTools();

    expect(tools.map((t) => t['name'])).toEqual(['a', 'b']);
    expect(sent.map((r) => r.params)).toEqual([{}, { cursor: 'page-2' }]);
  });

  it('listResources and listPrompts forward a cursor', async () => {
    const { fetchImpl, sent } = pagedFetch();
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl });

    const firstResources = await client.listResources();
    await client.listResources(firstResources['nextCursor'] as string);
    await client.listPrompts('page-2');

    expect(firstResources['nextCursor']).toBe('page-2');
    expect(sent.map((r) => [r.method, r.params])).toEqual([
      ['resources/list', {}],
      ['resources/list', { cursor: 'page-2' }],
      ['prompts/list', { cursor: 'page-2' }],
    ]);
  });
});

describe('McpStatelessClient — resource templates', () => {
  it('listResourceTemplates forwards a cursor and reports nextCursor', async () => {
    const { fetchImpl, sent } = pagedFetch();
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl });

    const first = await client.listResourceTemplates();
    const second = await client.listResourceTemplates(first['nextCursor'] as string);

    expect(first['nextCursor']).toBe('page-2');
    expect(second['nextCursor']).toBeUndefined();
    expect(sent.map((r) => [r.method, r.params])).toEqual([
      ['resources/templates/list', {}],
      ['resources/templates/list', { cursor: 'page-2' }],
    ]);
  });
});

describe('McpStatelessClientAdapter — list pagination', () => {
  it('serves resource templates, which McpClientService asks every remote for', async () => {
    const { fetchImpl } = pagedFetch();
    const adapter = new McpStatelessClientAdapter({ url: 'http://remote.test/', fetchImpl });

    const first = await adapter.listResourceTemplates();
    const second = await adapter.listResourceTemplates({ cursor: first.nextCursor });

    expect(first).toEqual({
      resourceTemplates: [{ uriTemplate: 'test://a/{id}', name: 'a' }],
      nextCursor: 'page-2',
    });
    expect(second).toEqual({ resourceTemplates: [{ uriTemplate: 'test://b/{id}', name: 'b' }] });
  });

  it('passes the cursor through and reports nextCursor', async () => {
    const { fetchImpl } = pagedFetch();
    const adapter = new McpStatelessClientAdapter({ url: 'http://remote.test/', fetchImpl });

    const first = await adapter.listPrompts();
    const second = await adapter.listPrompts({ cursor: first.nextCursor });

    expect(first).toEqual({ prompts: [{ name: 'a' }], nextCursor: 'page-2' });
    expect(second).toEqual({ prompts: [{ name: 'b' }] });
    expect(await adapter.listResources({ cursor: 'page-2' })).toEqual({ resources: [] });
  });

  it('lists every tool in one call', async () => {
    const { fetchImpl } = pagedFetch();
    const adapter = new McpStatelessClientAdapter({ url: 'http://remote.test/', fetchImpl });

    const { tools } = await adapter.listTools();

    expect(tools.map((t) => (t as { name: string }).name)).toEqual(['a', 'b']);
  });
});
