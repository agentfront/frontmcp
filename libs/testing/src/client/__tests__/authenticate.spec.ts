/**
 * `mcp.authenticate(token)` opens a session for the token and rejects when the server refuses it;
 * the token then survives `reconnect()`.
 */
import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3005';

interface Seen {
  method: string;
  authorization: string | null;
  session: string | null;
}

function stubServer(refuse: (authorization: string | null) => string | undefined): Seen[] {
  const seen: Seen[] = [];
  let sessionCounter = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    seen.push({
      method: body.method,
      authorization: headers.get('authorization'),
      session: headers.get('mcp-session-id'),
    });
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'initialize') {
      const reason = refuse(headers.get('authorization'));
      if (reason) return new Response(reason, { status: 401, statusText: 'Unauthorized' });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'test', version: '1.0.0' },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': `session-${++sessionCounter}` },
        },
      );
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return seen;
}

describe('McpTestClient.authenticate', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('opens a new session that carries the token', async () => {
    const seen = stubServer(() => undefined);
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
    await client.connect();
    const firstSession = client.sessionId;

    await client.authenticate('good-token');
    await client.tools.list();

    expect(client.sessionId).not.toBe(firstSession);
    expect(client.auth.isAnonymous).toBe(false);
    const list = seen.filter((s) => s.method === 'tools/list').pop();
    expect(list?.authorization).toBe('Bearer good-token');
    expect(list?.session).toBe(client.sessionId);
  });

  it('rejects with the server reason when the token is refused, and keeps the previous session usable', async () => {
    stubServer((authorization) => (authorization === 'Bearer expired-token' ? 'Token expired' : undefined));
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
    await client.connect();
    const firstSession = client.sessionId;

    await expect(client.authenticate('expired-token')).rejects.toThrow(/HTTP 401.*Token expired/);

    expect(client.sessionId).toBe(firstSession);
    expect(client.auth.isAnonymous).toBe(true);
    await expect(client.tools.list()).resolves.toEqual([]);
  });

  it('does not retry a 401 three times', async () => {
    const seen = stubServer(() => 'nope');
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();

    await expect(client.connect()).rejects.toThrow(/after 1 attempt: HTTP 401/);

    expect(seen.filter((s) => s.method === 'initialize')).toHaveLength(1);
  });

  it('rejects an empty token', async () => {
    stubServer(() => undefined);
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
    await expect(client.authenticate('')).rejects.toThrow('non-empty token');
  });

  it('keeps the token across reconnect()', async () => {
    const seen = stubServer(() => undefined);
    const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
    await client.connect();
    await client.authenticate('good-token');

    await client.reconnect();

    const initializes = seen.filter((s) => s.method === 'initialize');
    expect(initializes[initializes.length - 1].authorization).toBe('Bearer good-token');
    expect(client.auth.token).toBe('good-token');
  });

  it('only stores the token when not connected yet', async () => {
    const seen = stubServer(() => undefined);
    const client = McpTestClient.create({ baseUrl: BASE_URL }).build();
    await client.authenticate('early-token');
    expect(seen).toHaveLength(0);

    await client.connect();
    expect(seen.find((s) => s.method === 'initialize')?.authorization).toBe('Bearer early-token');
  });
});
