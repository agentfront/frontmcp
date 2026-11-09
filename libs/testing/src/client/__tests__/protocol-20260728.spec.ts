/**
 * `protocolVersion: '2026-07-28'`: the client discovers the server, sends each request statelessly with its
 * `_meta` and mirrored headers, answers `input_required` results, and listens for changes.
 */
import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3010';
const PROTOCOL = '2026-07-28';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

interface SentRequest {
  method: string;
  headers: Record<string, string>;
  body: { id?: number | string; method: string; params?: Record<string, unknown> };
}

const regionQueryTool = {
  name: 'region-query',
  inputSchema: {
    type: 'object',
    properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, query: { type: 'string' } },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An SSE response that sends `messages` and stays open until the request is aborted. */
function openEventStream(messages: unknown[], signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      signal?.addEventListener('abort', () => controller.close());
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function acknowledgement(params: Record<string, unknown> | undefined, refuse: boolean): unknown {
  const notifications = { ...(params?.['notifications'] as Record<string, unknown>) };
  if (refuse) delete notifications['resourceSubscriptions'];
  return { jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { notifications } };
}

function toolCallResult(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const name = params?.['name'];
  const inputResponses = params?.['inputResponses'] as Record<string, unknown> | undefined;
  if (name === 'confirm' && !inputResponses) {
    return {
      resultType: 'input_required',
      inputRequests: {
        'elicit-1': {
          method: 'elicitation/create',
          params: { message: 'Ship it?', requestedSchema: { type: 'object' } },
        },
      },
      requestState: 'state-1',
    };
  }
  if (name === 'summarize') {
    return {
      resultType: 'input_required',
      inputRequests: { 'sampling-1': { method: 'sampling/createMessage', params: { messages: [], maxTokens: 10 } } },
    };
  }
  const text = JSON.stringify(inputResponses?.['elicit-1'] ?? { called: name });
  return { resultType: 'complete', content: [{ type: 'text', text }] };
}

function stubStatelessServer(options: { refuseSubscriptions?: boolean } = {}): SentRequest[] {
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SentRequest['body'];
    sent.push({ method: body.method, headers: init?.headers as Record<string, string>, body });
    switch (body.method) {
      case 'server/discover':
        return json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            resultType: 'complete',
            supportedVersions: [PROTOCOL, '2025-06-18'],
            capabilities: { tools: { listChanged: true }, logging: {} },
            instructions: 'Use the tools.',
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'proto', version: '1.0.0' } },
            ttlMs: 0,
            cacheScope: 'public',
          },
        });
      case 'subscriptions/listen':
        return openEventStream(
          [
            acknowledgement(body.params, options.refuseSubscriptions === true),
            { jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: 'notes://1' } },
          ],
          init?.signal,
        );
      case 'tools/list':
        return json({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [regionQueryTool] } });
      case 'tools/call':
        return json({ jsonrpc: '2.0', id: body.id, result: toolCallResult(body.params) });
      case 'resources/read':
        return json({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', contents: [] } });
      default:
        return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }, 404);
    }
  }) as typeof fetch;
  return sent;
}

const clients: McpTestClient[] = [];

async function connectStateless(): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).withProtocolVersion(PROTOCOL).build();
  clients.push(client);
  await client.connect();
  return client;
}

describe('McpTestClient on protocol 2026-07-28', () => {
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    globalThis.fetch = realFetch;
  });

  it('connects with server/discover and a subscriptions/listen stream, without initialize or a session', async () => {
    const sent = stubStatelessServer();

    const mcp = await connectStateless();

    expect(sent.map(({ method }) => method)).toEqual(['server/discover', 'subscriptions/listen']);
    expect(mcp.protocolVersion).toBe(PROTOCOL);
    expect(mcp.serverInfo).toEqual({ name: 'proto', version: '1.0.0' });
    expect(mcp.instructions).toBe('Use the tools.');
    expect(mcp.hasCapability('tools')).toBe(true);
    expect(mcp.sessionId).toBe('');
  });

  it('declares the revision, client and log level in every request', async () => {
    const sent = stubStatelessServer();

    await connectStateless();

    const [discover] = sent;
    expect(discover.headers).toEqual(
      expect.objectContaining({ 'MCP-Protocol-Version': PROTOCOL, 'Mcp-Method': 'server/discover' }),
    );
    expect(discover.headers).not.toHaveProperty('mcp-session-id');
    expect(discover.body.params?.['_meta']).toEqual({
      [META_VERSION]: PROTOCOL,
      'io.modelcontextprotocol/clientInfo': { name: '@frontmcp/testing', version: '0.4.0' },
      'io.modelcontextprotocol/clientCapabilities': { sampling: {}, elicitation: { form: {} } },
      'io.modelcontextprotocol/logLevel': 'debug',
    });
  });

  it('asks for no log messages with mcpLogLevel false', async () => {
    const sent = stubStatelessServer();
    const mcp = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true, protocolVersion: PROTOCOL })
      .withMcpLogLevel(false)
      .build();
    clients.push(mcp);

    await mcp.connect();

    expect(sent[0].body.params?.['_meta']).not.toHaveProperty('io.modelcontextprotocol/logLevel');
  });

  it('lists the tools once before the first call, and mirrors x-mcp-header arguments into headers', async () => {
    const sent = stubStatelessServer();
    const mcp = await connectStateless();
    mcp.notifications.collectProgress();

    await mcp.tools.call('region-query', { region: 'eu-west', query: 'SELECT 1' });
    await mcp.tools.call('region-query', { region: 'us-east', query: 'SELECT 2' });

    const calls = sent.slice(2);
    expect(calls.map(({ method }) => method)).toEqual(['tools/list', 'tools/call', 'tools/call']);
    expect(calls[1].headers).toEqual(
      expect.objectContaining({
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'region-query',
        'Mcp-Param-Region': 'eu-west',
      }),
    );
    expect(calls[1].body.params?.['_meta']).toEqual(
      expect.objectContaining({ [META_VERSION]: PROTOCOL, progressToken: expect.anything() }),
    );
  });

  it('wraps a header value that is not plain ASCII in the Base64 sentinel', async () => {
    const sent = stubStatelessServer();
    const mcp = await connectStateless();

    await mcp.resources.read('notes://café');

    const read = sent.find(({ method }) => method === 'resources/read');
    expect(read?.headers['Mcp-Name']).toBe(`=?base64?${Buffer.from('notes://café').toString('base64')}?=`);
  });

  it('returns the JSON-RPC error a refused request carries in its HTTP error', async () => {
    stubStatelessServer();
    const mcp = await connectStateless();

    const response = await mcp.raw.request({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' });

    expect(response.error).toEqual({ code: -32601, message: 'Method not found' });
  });

  it('answers an input_required result with the elicitation handler, then sends the call again', async () => {
    const sent = stubStatelessServer();
    const mcp = await connectStateless();
    const asked: unknown[] = [];
    mcp.onElicitation((request) => {
      asked.push(request);
      return { action: 'accept', content: { confirmed: true } };
    });

    const result = await mcp.tools.call('confirm', {});

    expect(asked).toEqual([{ mode: 'form', message: 'Ship it?', requestedSchema: { type: 'object' } }]);
    const [first, retry] = sent.filter(({ method }) => method === 'tools/call');
    expect(retry.body.id).not.toBe(first.body.id);
    expect(retry.body.params).toEqual(
      expect.objectContaining({
        name: 'confirm',
        inputResponses: { 'elicit-1': { action: 'accept', content: { confirmed: true } } },
        requestState: 'state-1',
      }),
    );
    expect(result.json()).toEqual({ action: 'accept', content: { confirmed: true } });
  });

  it('declines without an elicitation handler', async () => {
    stubStatelessServer();
    const mcp = await connectStateless();

    const result = await mcp.tools.call('confirm', {});

    expect(result.json()).toEqual({ action: 'decline' });
  });

  it('fails a call whose server asks for input the client does not give', async () => {
    stubStatelessServer();
    const mcp = await connectStateless();

    const result = await mcp.tools.call('summarize', {});

    expect(result.isError).toBe(true);
    expect(result.error?.message).toContain('sampling/createMessage');
  });

  it('subscribes to a resource by listening with it, and records its updates but not the acknowledgement', async () => {
    const sent = stubStatelessServer();
    const mcp = await connectStateless();
    const notifications = mcp.notifications.collect();

    await mcp.resources.subscribe('notes://1');

    const listens = sent.filter(({ method }) => method === 'subscriptions/listen');
    expect(listens[1].body.params?.['notifications']).toEqual({
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: ['notes://1'],
    });
    await notifications.waitFor('notifications/resources/updated', 1000);
    expect(notifications.has('notifications/subscriptions/acknowledged')).toBe(false);
  });

  it('throws when the server does not acknowledge the resource subscription', async () => {
    stubStatelessServer({ refuseSubscriptions: true });
    const mcp = await connectStateless();

    await expect(mcp.resources.subscribe('admin://board')).rejects.toThrow(
      'Failed to subscribe to admin://board: the server did not acknowledge it',
    );
  });

  it('refuses the SSE transport, which 2026-07-28 does not have', () => {
    expect(() =>
      McpTestClient.create({ baseUrl: BASE_URL }).withProtocolVersion(PROTOCOL).withTransport('sse').build(),
    ).toThrow(/has no HTTP\+SSE transport/);
  });
});

describe('McpTestClient.discover() on an earlier protocol version', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends server/discover as a 2026-07-28 request, outside the session', async () => {
    const sent: SentRequest[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response(null, { status: 405 });
      const body = JSON.parse(String(init?.body)) as SentRequest['body'];
      sent.push({ method: body.method, headers: init?.headers as Record<string, string>, body });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result =
        body.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1.0.0' } }
          : { resultType: 'complete', supportedVersions: [PROTOCOL], capabilities: {} };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      });
    }) as typeof fetch;
    const mcp = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
    await mcp.connect();

    const discovered = await mcp.discover();
    await mcp.disconnect();

    const discover = sent.find(({ method }) => method === 'server/discover');
    expect(discovered.supportedVersions).toEqual([PROTOCOL]);
    expect(discover?.headers).toEqual(expect.objectContaining({ 'MCP-Protocol-Version': PROTOCOL }));
    expect(discover?.headers).not.toHaveProperty('mcp-session-id');
    expect(discover?.body.params?.['_meta']).toEqual(expect.objectContaining({ [META_VERSION]: PROTOCOL }));
  });
});
