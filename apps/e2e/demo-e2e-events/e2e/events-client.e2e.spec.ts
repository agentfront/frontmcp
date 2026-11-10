/**
 * E2E tests for the client side of MCP Events: `client.events` of `McpTestClient` lists the events and subscribes by
 * poll, by push (over a session and under protocol 2026-07-28) and by webhook, against a real server.
 */
import type { EventOccurrence, EventSubscription } from '@frontmcp/sdk';
import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  WebhookReceiver,
  type McpTestClientBuilder,
} from '@frontmcp/testing';

/** The next `count` occurrences of a subscription. */
async function take(subscription: EventSubscription, count: number): Promise<EventOccurrence[]> {
  const iterator = subscription[Symbol.asyncIterator]();
  const taken: EventOccurrence[] = [];
  while (taken.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    taken.push(next.value);
  }
  return taken;
}

/** The order ids of occurrences. */
function orderIdsOf(occurrences: EventOccurrence[]): unknown[] {
  return occurrences.map((occurrence) => occurrence.data['orderId']);
}

describe('Events client E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  let receiver: WebhookReceiver;
  const clients: McpTestClient[] = [];
  const subscriptions: EventSubscription[] = [];

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: oauthInfo.issuer, audience: oauthInfo.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    receiver = new WebhookReceiver();
    await receiver.start();

    server = await TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
        EVENTS_HEARTBEAT_MS: '300',
        EVENTS_NEXT_POLL_MS: '100',
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterEach(async () => {
    await Promise.all(subscriptions.splice(0).map((subscription) => subscription.cancel()));
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    receiver.clear();
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (receiver) await receiver.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  async function connectAs(
    sub: string,
    roles: string[] = [],
    configure: (builder: McpTestClientBuilder) => McpTestClientBuilder = (builder) => builder,
  ): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub, claims: { roles } });
    const builder = McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    });
    const client = await configure(builder.withEvents({ pollFloorMs: 50 })).buildAndConnect();
    clients.push(client);
    return client;
  }

  async function subscribe(
    client: McpTestClient,
    ...args: Parameters<McpTestClient['events']['subscribe']>
  ): Promise<EventSubscription> {
    const subscription = await client.events.subscribe(...args);
    subscriptions.push(subscription);
    return subscription;
  }

  it('lists the events the caller may see', async () => {
    const client = await connectAs('ada');

    const events = await client.events.list();

    expect(events.map((definition) => definition.name)).toEqual(['order.created', 'ticket.updated']);
  });

  it('subscribes by push over a session, filtered by its arguments', async () => {
    const client = await connectAs('bob');
    const subscription = await subscribe(client, 'order.created', { status: 'paid' });

    await client.tools.call('place-order', { orderId: 'c-1', status: 'refunded' });
    await client.tools.call('place-order', { orderId: 'c-2', status: 'paid' });

    expect(subscription.mode).toBe('push');
    expect(orderIdsOf(await take(subscription, 1))).toEqual(['c-2']);
  });

  it('subscribes by push under protocol 2026-07-28', async () => {
    const client = await connectAs('carol', [], (builder) => builder.withProtocolVersion('2026-07-28'));
    const subscription = await subscribe(client, 'order.created');

    await client.tools.call('place-order', { orderId: 'c-3' });

    expect(subscription.mode).toBe('push');
    expect(orderIdsOf(await take(subscription, 1))).toEqual(['c-3']);
  });

  it('subscribes by poll when asked, to a published event and to a replayable one', async () => {
    const client = await connectAs('dave');
    const orders = await subscribe(client, 'order.created', {}, { delivery: 'poll' });
    const tickets = await subscribe(client, 'ticket.updated', { queue: 'billing' }, { delivery: 'poll' });

    await client.tools.call('place-order', { orderId: 'c-4' });
    await client.tools.call('update-ticket', { ticketId: 't-9', queue: 'billing' });

    expect(orders.mode).toBe('poll');
    expect(orderIdsOf(await take(orders, 1))).toEqual(['c-4']);
    expect((await take(tickets, 1))[0].data).toEqual({ ticketId: 't-9', queue: 'billing' });
  });

  it('subscribes by webhook through a receiver, and unsubscribes on cancel', async () => {
    const client = await connectAs('erin', [], (builder) =>
      builder.withEvents({ pollFloorMs: 50, webhook: { url: receiver.url, receiver: receiver.eventReceiver } }),
    );
    const subscription = await subscribe(client, 'order.created', { region: 'client' });

    await client.tools.call('place-order', { orderId: 'c-5' });
    const [occurrence] = await take(subscription, 1);
    await subscription.cancel();
    await client.tools.call('place-order', { orderId: 'c-6' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(subscription.mode).toBe('webhook');
    expect(subscription.id).toMatch(/^sub_/);
    expect(occurrence.data['orderId']).toBe('c-5');
    expect(receiver.verifications()[0]).toMatchObject({ signatureCheck: 'valid', answeredStatus: 200 });
    expect(receiver.deliveries().map((delivery) => delivery.json?.['data'])).toEqual([
      expect.objectContaining({ orderId: 'c-5' }),
    ]);
  });

  it('rejects a subscription the server refuses', async () => {
    const member = await connectAs('frank', ['member']);

    await expect(member.events.subscribe('audit.logged')).rejects.toMatchObject({ rpcCode: -32024 });
    await expect(member.events.subscribe('order.created', { status: 7 })).rejects.toMatchObject({ rpcCode: -32602 });
  });
});
