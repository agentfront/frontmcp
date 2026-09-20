/**
 * Issue #543 — a server with a non-default `http.entryPath` was untestable.
 *
 * The fixture built its client from the booted server's base URL and nothing
 * else, and every request went to `${baseUrl}/`. Setting `http.entryPath: '/mcp'`
 * therefore 404'd every spec in the suite — including ones unrelated to the
 * change — with a bare `HTTP 404` raised from inside `@frontmcp/testing`.
 */
import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3003';

interface Recorded {
  url: string;
  init: RequestInit;
}

/** Stub `fetch`, recording every call and replying with a canned MCP response. */
function stubFetch(reply: (url: string, call: number) => { status: number; body: string }): Recorded[] {
  const calls: Recorded[] = [];
  let callCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const { status, body } = reply(url, callCount++);
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function initializeResult(id: unknown = 1): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      serverInfo: { name: 'test', version: '1.0.0' },
    },
  });
}

const NOT_FOUND_BODY = JSON.stringify({ error: 'Not Found', entryPaths: ['/mcp'] });

describe('McpTestClient entryPath (#543)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('posts to the server root when no entryPath is configured', async () => {
    const calls = stubFetch(() => ({ status: 200, body: initializeResult() }));
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();

    await client.connect();

    expect(calls[0].url).toBe(`${BASE_URL}/`);
  });

  it('posts to the configured entryPath', async () => {
    const calls = stubFetch(() => ({ status: 200, body: initializeResult() }));
    const client = McpTestClient.create({ baseUrl: BASE_URL, entryPath: '/mcp', publicMode: true }).build();

    await client.connect();

    expect(calls[0].url).toBe(`${BASE_URL}/mcp`);
  });

  it('normalizes an entryPath given without a leading slash or with a trailing one', async () => {
    for (const entryPath of ['mcp', '/mcp/', 'mcp/']) {
      const calls = stubFetch(() => ({ status: 200, body: initializeResult() }));
      const client = McpTestClient.create({ baseUrl: BASE_URL, entryPath, publicMode: true }).build();

      await client.connect();

      expect(calls[0].url).toBe(`${BASE_URL}/mcp`);
    }
  });

  it('recovers from a root 404 by reconnecting at the path the server reports', async () => {
    const calls = stubFetch((url) =>
      url === `${BASE_URL}/` ? { status: 404, body: NOT_FOUND_BODY } : { status: 200, body: initializeResult() },
    );
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();

    await expect(client.connect()).resolves.toBeDefined();

    expect(calls[0].url).toBe(`${BASE_URL}/`);
    expect(calls.some((call) => call.url === `${BASE_URL}/mcp`)).toBe(true);
  });

  it('reports the paths the server serves when it cannot recover', async () => {
    // Every path 404s, so discovery cannot help — the error must still name
    // what the server said instead of a bare "HTTP 404: Not Found".
    stubFetch(() => ({ status: 404, body: JSON.stringify({ error: 'Not Found', entryPaths: ['/a', '/b'] }) }));
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();

    await expect(client.connect()).rejects.toThrow(/serves MCP at \/a, \/b/);
  });

  it('keeps a query string on the MCP endpoint instead of mangling it', async () => {
    const calls = stubFetch(() => ({ status: 200, body: initializeResult() }));
    const client = McpTestClient.create({
      baseUrl: BASE_URL,
      entryPath: '/mcp',
      queryParams: { mode: 'skills_only' },
      publicMode: true,
    }).build();

    await client.connect();

    expect(calls[0].url).toBe(`${BASE_URL}/mcp?mode=skills_only`);
  });

  it('re-attempts discovery on a reconnect, in case the server moved', async () => {
    let servedPath = '/mcp';
    const calls = stubFetch((url) =>
      url === `${BASE_URL}${servedPath}`
        ? { status: 200, body: initializeResult() }
        : { status: 404, body: JSON.stringify({ error: 'Not Found', entryPaths: [servedPath] }) },
    );
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();

    await client.connect();
    await client.disconnect();

    servedPath = '/rpc';
    calls.length = 0;
    await expect(client.connect()).resolves.toBeDefined();
    expect(calls.some((call) => call.url === `${BASE_URL}/rpc`)).toBe(true);
  });

  it('names the URL it tried in the failure message', async () => {
    stubFetch(() => ({ status: 500, body: JSON.stringify({ error: 'boom' }) }));
    const client = McpTestClient.create({ baseUrl: BASE_URL, entryPath: '/mcp', publicMode: true }).build();

    await expect(client.connect()).rejects.toThrow(new RegExp(`${BASE_URL}/mcp`));
  });
});
