/**
 * Legacy HTTP+SSE transport (issue #680: `test.use({ transport: 'sse' })` threw
 * "SSE transport not yet implemented").
 *
 * `fetch` is replaced with an in-memory legacy SSE server: `GET /sse` opens a stream whose first
 * event names the message endpoint, POSTs are answered 202 and their responses arrive on the stream.
 */
import { McpTestClient } from '../../client/mcp-test-client';
import { SseTransport } from '../sse.transport';

const BASE_URL = 'http://localhost:3006';

interface RpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

interface FakeServer {
  posts: Array<{ url: string; headers: Record<string, string>; message: RpcMessage }>;
  getRequests: Array<{ url: string; headers: Record<string, string> }>;
  push(message: unknown): void;
  end(): void;
}

interface FakeServerOptions {
  /** Status of the `GET /sse` response (default 200) */
  sseStatus?: number;
  /** Answer one message; `undefined` sends nothing back on the stream */
  answer?: (message: RpcMessage, server: FakeServer) => unknown;
  /** Status of every POST (default 202) */
  postStatus?: number;
  /** Close the stream before sending the endpoint event */
  noEndpoint?: boolean;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return { ...(init?.headers as Record<string, string> | undefined) };
}

function defaultAnswer(message: RpcMessage): unknown {
  if (message.id === undefined) return undefined;
  switch (message.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } },
      };
    case 'tools/list':
      return { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } };
    case 'tools/call':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ echoed: message.params?.['arguments'] }) }] },
      };
    default:
      return undefined;
  }
}

function stubSseServer(options: FakeServerOptions = {}): FakeServer {
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const server: FakeServer = {
    posts: [],
    getRequests: [],
    push(message) {
      stream?.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
    },
    end() {
      stream?.close();
      stream = undefined;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'GET') {
      server.getRequests.push({ url, headers: headersOf(init) });
      if (options.sseStatus && options.sseStatus !== 200) {
        return new Response('Not Found', { status: options.sseStatus, statusText: 'Not Found' });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          if (options.noEndpoint) {
            controller.close();
            return;
          }
          // Split across chunks and CRLF line endings: the parser must cope with both
          controller.enqueue(encoder.encode(': keep-alive\r\n\r\nevent: endpoint\r\n'));
          controller.enqueue(encoder.encode('data: /message?sessionId=sse-session-1\r\n\r\n'));
        },
      });
      init.signal?.addEventListener('abort', () => {
        try {
          stream?.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // already closed
        }
        stream = undefined;
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    let message: RpcMessage;
    try {
      message = JSON.parse(String(init?.body)) as RpcMessage;
    } catch {
      return new Response('Invalid message', { status: 400, statusText: 'Bad Request' });
    }
    server.posts.push({ url, headers: headersOf(init), message });
    if (options.postStatus && options.postStatus !== 202) {
      return new Response('rejected', { status: options.postStatus, statusText: 'Bad Request' });
    }
    const answer = (options.answer ?? defaultAnswer)(message, server);
    // The response travels on the stream, after the POST is accepted
    if (answer !== undefined) setTimeout(() => server.push(answer), 5);
    return new Response('Accepted', { status: 202 });
  }) as typeof fetch;

  return server;
}

const clients: McpTestClient[] = [];

async function connectClient(entryPath?: string): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: BASE_URL, transport: 'sse', publicMode: true, entryPath }).build();
  clients.push(client);
  await client.connect();
  return client;
}

describe('SseTransport (legacy HTTP+SSE)', () => {
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect().catch(() => undefined)));
    globalThis.fetch = realFetch;
  });

  it('connects through GET /sse and POSTs to the endpoint the server names', async () => {
    const server = stubSseServer();
    const mcp = await connectClient();

    expect(server.getRequests[0].url).toBe(`${BASE_URL}/sse`);
    expect(server.getRequests[0].headers['Accept']).toBe('text/event-stream');
    expect(server.posts[0].url).toBe(`${BASE_URL}/message?sessionId=sse-session-1`);
    expect(server.posts.map((p) => p.message.method)).toEqual(['initialize', 'notifications/initialized']);
    expect(mcp.sessionId).toBe('sse-session-1');
    expect(mcp.isConnected()).toBe(true);
  });

  it('correlates responses that arrive on the stream with their requests', async () => {
    stubSseServer();
    const mcp = await connectClient();

    const tools = await mcp.tools.list();
    const result = await mcp.tools.call('echo', { text: 'hi' });

    expect(tools.map((t) => t.name)).toEqual(['echo']);
    expect(result.json()).toEqual({ echoed: { text: 'hi' } });
  });

  it('mounts /sse under the entry path', async () => {
    const server = stubSseServer();
    await connectClient('/mcp');
    expect(server.getRequests[0].url).toBe(`${BASE_URL}/mcp/sse`);
  });

  it('records notifications the server sends on the stream', async () => {
    const server = stubSseServer();
    const mcp = await connectClient();
    const collected = mcp.notifications.collect();

    server.push({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });

    const notification = await collected.waitFor('notifications/tools/list_changed', 1000);
    expect(notification.method).toBe('notifications/tools/list_changed');
  });

  it('answers server→client elicitation with the registered handler', async () => {
    const server = stubSseServer({
      answer: (message, srv) => {
        if (message.method === 'tools/call') {
          // Ask the client first; reply to the tool call once the client answered
          srv.push({ jsonrpc: '2.0', id: 'elicit-1', method: 'elicitation/create', params: { message: 'Sure?' } });
          return undefined;
        }
        if (message.id === 'elicit-1') {
          srv.push({
            jsonrpc: '2.0',
            id: 'call-pending',
            result: { content: [{ type: 'text', text: JSON.stringify(message.result) }] },
          });
          return undefined;
        }
        return defaultAnswer(message);
      },
    });
    const mcp = await connectClient();
    mcp.onElicitation(async () => ({ action: 'accept', content: { ok: true } }));

    // The fake answers with a fixed id, so wait for the reply to the elicitation itself
    void mcp.tools.call('confirm', {}).catch(() => undefined);
    const deadline = Date.now() + 1000;
    while (!server.posts.some((p) => p.message.id === 'elicit-1') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const reply = server.posts.find((p) => p.message.id === 'elicit-1');
    expect(reply?.message.result).toEqual({ action: 'accept', content: { ok: true } });
  });

  it('answers ping and refuses other server requests', async () => {
    const server = stubSseServer();
    await connectClient();

    server.push({ jsonrpc: '2.0', id: 'p1', method: 'ping' });
    server.push({ jsonrpc: '2.0', id: 'r1', method: 'roots/list' });
    const deadline = Date.now() + 1000;
    while (server.posts.filter((p) => p.message.id === 'p1' || p.message.id === 'r1').length < 2) {
      if (Date.now() > deadline) throw new Error('no replies');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(server.posts.find((p) => p.message.id === 'p1')?.message.result).toEqual({});
    expect(server.posts.find((p) => p.message.id === 'r1')?.message.error).toEqual(
      expect.objectContaining({ code: -32601 }),
    );
  });

  it('turns a rejected POST into a JSON-RPC error without waiting for the stream', async () => {
    stubSseServer();
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await transport.connect();
    stubSseServer({ postStatus: 400 });
    // Keep the open stream: only POSTs change
    const response = await transport.request({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(response.error).toEqual(expect.objectContaining({ code: -32000, message: 'HTTP 400: Bad Request' }));
    await transport.close();
  });

  it('times out a request the stream never answers', async () => {
    stubSseServer({ answer: () => undefined });
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true, timeout: 100 });
    await transport.connect();
    const response = await transport.request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.error).toEqual(expect.objectContaining({ message: 'Request timeout after 100ms' }));
    await transport.close();
  });

  it('fails pending requests when the server closes the stream', async () => {
    const server = stubSseServer({ answer: () => undefined });
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await transport.connect();
    const pending = transport.request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    server.end();
    const response = await pending;
    expect(response.error).toEqual(expect.objectContaining({ message: 'SSE stream closed by the server' }));
    expect(transport.isConnected()).toBe(false);
  });

  it('explains a server without the legacy SSE endpoint', async () => {
    stubSseServer({ sseStatus: 404 });
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await expect(transport.connect()).rejects.toThrow(/HTTP 404.*legacy: true/s);
    expect(transport.getState()).toBe('error');
  });

  it('fails a stream that ends before naming its endpoint', async () => {
    stubSseServer({ noEndpoint: true });
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await expect(transport.connect()).rejects.toThrow(/ended before the server sent its endpoint/);
  });

  it('sends the token and the session id on POSTs, and exposes the message endpoint', async () => {
    const server = stubSseServer();
    const transport = new SseTransport({ baseUrl: BASE_URL, auth: { token: 'tok' } });
    await transport.connect();
    expect(transport.getMessageEndpoint()).toBe(`${BASE_URL}/message?sessionId=sse-session-1`);
    await transport.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const headers = server.posts[0].headers;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['mcp-session-id']).toBe('sse-session-1');
    expect(transport.getLastRequestHeaders()['Authorization']).toBe('Bearer tok');
    await transport.close();
    expect(transport.getSessionId()).toBeUndefined();
  });

  it('requests an anonymous token when none is given outside public mode', async () => {
    const server = stubSseServer();
    const sseFetch = globalThis.fetch;
    const tokenRequests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/oauth/token')) {
        tokenRequests.push(String(input));
        return new Response(JSON.stringify({ access_token: 'anon' }), { status: 200 });
      }
      return sseFetch(input, init);
    }) as typeof fetch;
    const transport = new SseTransport({ baseUrl: BASE_URL });
    await transport.connect();
    expect(tokenRequests).toEqual([`${BASE_URL}/oauth/token`]);
    expect(server.getRequests[0].headers['Authorization']).toBe('Bearer anon');
    await transport.close();
  });

  it('sendRaw waits for the response to a message with an id and reports a rejected body', async () => {
    stubSseServer();
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await transport.connect();
    const answered = await transport.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }));
    expect(answered.result).toEqual({ tools: [expect.objectContaining({ name: 'echo' })] });

    stubSseServer({ postStatus: 400 });
    const rejected = await transport.sendRaw('not json');
    expect(rejected.error).toEqual(expect.objectContaining({ code: -32700 }));
    await transport.close();
  });

  it('reconnects after a simulated disconnect', async () => {
    stubSseServer();
    const transport = new SseTransport({ baseUrl: BASE_URL, publicMode: true });
    await transport.connect();
    await transport.simulateDisconnect();
    expect(transport.isConnected()).toBe(false);
    await transport.waitForReconnect(1000);
    expect(transport.isConnected()).toBe(true);
    expect(transport.getConnectionCount()).toBe(2);
    expect(transport.getReconnectCount()).toBe(1);
    await transport.close();
  });
});
