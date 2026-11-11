/**
 * E2E tests for `events/stream` (MCP Events, SEP-3415): the push mode over Streamable HTTP under protocol 2026-07-28,
 * against a real server in transparent auth mode. The request is a POST whose response is an SSE stream.
 */
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

const PROTOCOL = '2026-07-28';
const SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId';

interface WireMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

interface OpenStream {
  response: Response;
  /** Reads until `count` more messages arrived. */
  read(count: number): Promise<WireMessage[]>;
  close(): Promise<void>;
}

describe('Events stream E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  const clients: McpTestClient[] = [];
  const streams: OpenStream[] = [];
  let nextRequestId = 100;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: oauthInfo.issuer, audience: oauthInfo.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    server = await TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
        EVENTS_HEARTBEAT_MS: '300',
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterEach(async () => {
    await Promise.all(streams.splice(0).map((stream) => stream.close()));
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  function tokenFor(sub: string, roles: string[] = []): Promise<string> {
    return tokenFactory.createTestToken({ sub, claims: { roles } });
  }

  async function connectAs(sub: string, roles: string[] = []): Promise<McpTestClient> {
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token: await tokenFor(sub, roles) },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  async function openStream(token: string, params: Record<string, unknown>, id = nextRequestId++): Promise<OpenStream> {
    const controller = new AbortController();
    const response = await fetch(server.info.baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        'mcp-method': 'events/stream',
        'mcp-name': String(params['name']),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'events/stream',
        params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL } },
      }),
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const decoder = new TextDecoder();
    let text = '';
    const pending: WireMessage[] = [];
    const stream: OpenStream = {
      response,
      async read(count) {
        reader ??= response.body?.getReader();
        while (pending.length < count && reader) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          const frames = text.split('\n\n');
          text = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split('\n').find((line) => line.startsWith('data: '));
            if (data) pending.push(JSON.parse(data.slice('data: '.length)));
          }
        }
        return pending.splice(0, count);
      },
      async close() {
        controller.abort();
        await reader?.cancel().catch(() => undefined);
      },
    };
    streams.push(stream);
    return stream;
  }

  /** The next `count` messages of a stream that are not heartbeats. */
  async function readEvents(stream: OpenStream, count: number): Promise<WireMessage[]> {
    const messages: WireMessage[] = [];
    while (messages.length < count) {
      const [message] = await stream.read(1);
      if (!message) break;
      if (message.method !== 'notifications/events/heartbeat') messages.push(message);
    }
    return messages;
  }

  it('confirms the stream, then pushes what a tool publishes, tagged with the id of the request', async () => {
    const client = await connectAs('ada');
    const stream = await openStream(await tokenFor('ada'), { name: 'order.created' }, 7);

    const [active] = await readEvents(stream, 1);
    await client.tools.call('place-order', { orderId: 's-1', status: 'paid', total: 5 });
    const [delivered] = await readEvents(stream, 1);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(active).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/events/active',
      params: { cursor: expect.any(String), truncated: false, _meta: { [SUBSCRIPTION_ID]: 7 } },
    });
    expect(delivered).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/events/event',
      params: {
        eventId: expect.stringMatching(/^evt_/),
        name: 'order.created',
        timestamp: expect.any(String),
        data: { orderId: 's-1', status: 'paid', total: 5 },
        cursor: expect.any(String),
        _meta: { [SUBSCRIPTION_ID]: 7 },
      },
    });
  });

  it('sends a heartbeat with the cursor while nothing happens', async () => {
    const stream = await openStream(await tokenFor('bob'), { name: 'order.created' });

    const [active, heartbeat] = await stream.read(2);

    expect(heartbeat).toMatchObject({
      method: 'notifications/events/heartbeat',
      params: { cursor: active.params?.['cursor'] },
    });
  });

  it('pushes to each stream what its arguments and its reader should get', async () => {
    const client = await connectAs('carol', ['member']);
    const paid = await openStream(await tokenFor('carol', ['member']), {
      name: 'order.created',
      arguments: { status: 'paid' },
    });
    const admins = await openStream(await tokenFor('dave', ['admin']), { name: 'order.created' });
    await readEvents(paid, 1);
    await readEvents(admins, 1);

    await client.tools.call('place-order', { orderId: 's-2', status: 'refunded' });
    await client.tools.call('place-order', { orderId: 's-3', status: 'paid', audienceRole: 'admin' });
    await client.tools.call('place-order', { orderId: 's-4', status: 'paid' });

    const forPaid = await readEvents(paid, 1);
    const forAdmins = await readEvents(admins, 3);
    expect(forPaid.map((message) => (message.params?.['data'] as { orderId: string }).orderId)).toEqual(['s-4']);
    expect(forAdmins.map((message) => (message.params?.['data'] as { orderId: string }).orderId)).toEqual([
      's-2',
      's-3',
      's-4',
    ]);
  });

  it('replays from the cursor of an earlier stream', async () => {
    const client = await connectAs('erin');
    const token = await tokenFor('erin');
    const first = await openStream(token, { name: 'order.created' });
    const [active] = await readEvents(first, 1);
    await first.close();
    await client.tools.call('place-order', { orderId: 's-5' });

    const resumed = await openStream(token, { name: 'order.created', cursor: active.params?.['cursor'] });
    const [confirmed, replayed] = await readEvents(resumed, 2);

    expect(confirmed.params).toMatchObject({ truncated: false });
    expect(replayed.params?.['data']).toMatchObject({ orderId: 's-5' });
  });

  it('answers a refusal as a JSON-RPC error and opens no stream', async () => {
    const member = await tokenFor('frank', ['member']);

    const unknown = await openStream(member, { name: 'order.refunded' }, 21);
    const forbidden = await openStream(member, { name: 'audit.logged' }, 22);

    expect(unknown.response.headers.get('content-type')).toContain('application/json');
    await expect(unknown.response.json()).resolves.toMatchObject({ id: 21, error: { code: -32023 } });
    await expect(forbidden.response.json()).resolves.toMatchObject({ id: 22, error: { code: -32024 } });
  });
});
