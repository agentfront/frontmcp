/**
 * E2E tests for `events/poll` (MCP Events, SEP-3415): a client reads published events and a replayable upstream from
 * a cursor, against a real server in transparent auth mode.
 */
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

interface PollResult {
  events: Array<{ eventId: string; name: string; timestamp: string; data: Record<string, unknown> }>;
  cursor: string | null;
  truncated: boolean;
  hasMore: boolean;
  nextPollMs: number;
}

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

describe('Events poll E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  const clients: McpTestClient[] = [];
  let nextRequestId = 1;

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
      env: { IDP_PROVIDER_URL: finalOauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  async function connectAs(sub: string, roles: string[] = [], platform?: 'openai'): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub, claims: { roles } });
    const builder = McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    });
    const client = await (platform ? builder.withPlatform(platform) : builder).buildAndConnect();
    clients.push(client);
    return client;
  }

  async function rpc(client: McpTestClient, method: string, params: Record<string, unknown>): Promise<RpcReply> {
    const reply = await client.raw.request({ jsonrpc: '2.0', id: `poll-${nextRequestId++}`, method, params });
    return reply as RpcReply;
  }

  async function poll(client: McpTestClient, params: Record<string, unknown>): Promise<PollResult> {
    const reply = await rpc(client, 'events/poll', { name: 'order.created', ...params });
    if (reply.error) throw new Error(`events/poll failed: ${reply.error.message}`);
    return reply.result as unknown as PollResult;
  }

  function orderIdsOf(result: PollResult): unknown[] {
    return result.events.map((occurrence) => occurrence.data['orderId']);
  }

  it('lists the events as offered by poll and by webhook', async () => {
    const client = await connectAs('ada');

    const listed = await rpc(client, 'events/list', {});

    expect(listed.result?.['events']).toEqual([
      expect.objectContaining({ name: 'order.created', delivery: ['poll', 'webhook'] }),
      expect.objectContaining({ name: 'ticket.updated', delivery: ['poll', 'webhook'] }),
    ]);
  });

  it('starts from now on a null cursor, then returns what a tool published', async () => {
    const client = await connectAs('ada');

    const start = await poll(client, { cursor: null });
    await client.tools.call('place-order', { orderId: 'p-1', status: 'paid', total: 12 });
    const next = await poll(client, { cursor: start.cursor });
    const again = await poll(client, { cursor: next.cursor });

    expect(start).toEqual({
      events: [],
      cursor: expect.any(String),
      truncated: false,
      hasMore: false,
      nextPollMs: 30000,
    });
    expect(next.events).toEqual([
      {
        eventId: expect.stringMatching(/^evt_/),
        name: 'order.created',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        data: { orderId: 'p-1', status: 'paid', total: 12 },
      },
    ]);
    expect(again.events).toEqual([]);
    expect(again.cursor).toBe(next.cursor);
  });

  it('filters by the arguments of the poll, and drains a backlog with maxEvents and hasMore', async () => {
    const client = await connectAs('bob');
    const { cursor } = await poll(client, {});
    for (const [orderId, status] of [
      ['p-2', 'paid'],
      ['p-3', 'refunded'],
      ['p-4', 'paid'],
      ['p-5', 'paid'],
    ]) {
      await client.tools.call('place-order', { orderId, status });
    }
    const paid = { arguments: { status: 'paid' }, maxEvents: 2 };

    const first = await poll(client, { cursor, ...paid });
    const second = await poll(client, { cursor: first.cursor, ...paid });

    expect(orderIdsOf(first)).toEqual(['p-2', 'p-4']);
    expect(first.hasMore).toBe(true);
    expect(orderIdsOf(second)).toEqual(['p-5']);
    expect(second.hasMore).toBe(false);
  });

  it('gives an event published for a role to the readers who have it', async () => {
    const admin = await connectAs('carol', ['admin']);
    const member = await connectAs('dave', ['member']);
    const adminStart = await poll(admin, {});
    const memberStart = await poll(member, {});

    await member.tools.call('place-order', { orderId: 'p-6', audienceRole: 'admin' });

    expect(orderIdsOf(await poll(admin, { cursor: adminStart.cursor }))).toEqual(['p-6']);
    expect(orderIdsOf(await poll(member, { cursor: memberStart.cursor }))).toEqual([]);
  });

  it('answers a cursor it cannot place with truncated and a fresh cursor', async () => {
    const client = await connectAs('erin');

    const result = await poll(client, { cursor: 'ffffffffffffffffffffffffffffffff.1' });

    expect(result).toMatchObject({ events: [], truncated: true, hasMore: false });
    expect(result.cursor).not.toBe('ffffffffffffffffffffffffffffffff.1');
  });

  it('reads a replayable event through check(), with the cursor of its upstream', async () => {
    const client = await connectAs('frank');
    const start = await poll(client, { name: 'ticket.updated', arguments: { queue: 'billing' } });
    await client.tools.call('update-ticket', { ticketId: 't-1', queue: 'billing' });
    await client.tools.call('update-ticket', { ticketId: 't-2', queue: 'support' });
    await client.tools.call('update-ticket', { ticketId: 't-3', queue: 'billing' });

    const next = await poll(client, { name: 'ticket.updated', arguments: { queue: 'billing' }, cursor: start.cursor });

    expect(start.events).toEqual([]);
    expect(next.events.map((occurrence) => occurrence.data)).toEqual([
      { ticketId: 't-1', queue: 'billing' },
      { ticketId: 't-3', queue: 'billing' },
    ]);
    expect(Number(next.cursor)).toBe(Number(start.cursor) + 3);
    expect(next.hasMore).toBe(false);
  });

  it('refuses what it refuses to a subscription, with the code of the caller dialect', async () => {
    const member = await connectAs('grace', ['member']);
    const chatgpt = await connectAs('heidi', ['member'], 'openai');
    const anonymous = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
    }).buildAndConnect();
    clients.push(anonymous);

    const unknown = await rpc(member, 'events/poll', { name: 'order.refunded' });
    const forbidden = await rpc(member, 'events/poll', { name: 'audit.logged' });
    const invalid = await rpc(member, 'events/poll', { name: 'order.created', arguments: { status: 7 } });
    const sketchUnknown = await rpc(chatgpt, 'events/poll', { name: 'order.refunded' });
    const anonymousPoll = await rpc(anonymous, 'events/poll', { name: 'order.created' });

    expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event' } });
    expect(forbidden.error?.code).toBe(-32024);
    expect(invalid.error?.code).toBe(-32602);
    expect(sketchUnknown.error?.code).toBe(-32011);
    expect(anonymousPoll.error?.code).toBe(-32024);
  });
});
