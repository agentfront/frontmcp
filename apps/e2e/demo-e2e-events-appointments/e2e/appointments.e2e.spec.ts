/**
 * Smoke test of the appointments example: a booking reaches the staff of its business only, with an opaque
 * conversation id, and the business's reply reaches the customer who booked only.
 */
import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  WebhookReceiver,
  type ReceivedWebhook,
} from '@frontmcp/testing';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

describe('Appointments example', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  let receiver: WebhookReceiver;
  const secret = generateStandardWebhookSecret();
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

    receiver = new WebhookReceiver({ secrets: [secret] });
    await receiver.start();

    server = await TestServer.start({
      project: 'demo-e2e-events-appointments',
      command: 'npx tsx apps/e2e/demo-e2e-events-appointments/src/main.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
        EVENTS_ALLOW_LOCAL_CALLBACKS: 'true',
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.disconnect()));
    if (server) await server.stop();
    if (receiver) await receiver.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  /** A client signed in as `sub` with these claims, disconnected after the tests. */
  async function connectAs(sub: string, claims: Record<string, unknown> = {}): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub, claims });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  /** A webhook subscription of a client to an event, delivered to the test receiver. */
  async function subscribe(client: McpTestClient, name: string): Promise<RpcReply> {
    const reply = await client.raw.request({
      jsonrpc: '2.0',
      id: `appointments-${nextRequestId++}`,
      method: 'events/subscribe',
      params: { name, delivery: { url: receiver.url, secret } },
    });
    return reply as RpcReply;
  }

  /** The deliveries one subscription received, once `count` arrived and a moment passed for any extra one. */
  async function deliveredTo(subscriptionId: unknown, count: number): Promise<ReceivedWebhook[]> {
    await receiver.waitForDeliveries(count, 10_000).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return receiver.deliveries().filter((delivery) => delivery.subscriptionId === subscriptionId);
  }

  it('tells the staff of the booked business, tells its customer the reply, and nobody else', async () => {
    const receptionist = await connectAs('rita', { roles: ['receptionist'], tenantId: 'salon-a' });
    const otherSalon = await connectAs('oscar', { roles: ['admin'], tenantId: 'salon-b' });
    const customer = await connectAs('carla');
    const otherCustomer = await connectAs('dan');

    const staffSubscription = await subscribe(receptionist, 'appointment.created');
    const otherSalonSubscription = await subscribe(otherSalon, 'appointment.created');
    const customerReplies = await subscribe(customer, 'appointment.reply');
    const otherCustomerReplies = await subscribe(otherCustomer, 'appointment.reply');
    const refused = await subscribe(customer, 'appointment.created');

    expect(staffSubscription.error).toBeUndefined();
    expect(refused.error?.code).toBe(-32024);

    const booked = await customer.tools.call('book_appointment', {
      businessId: 'salon-a',
      service: 'haircut',
      startsAt: '2026-12-01T10:00:00Z',
    });
    expect(booked).toBeSuccessful();
    const [created] = await deliveredTo(staffSubscription.result?.['id'], 1);

    expect(created.json?.['data']).toEqual({
      appointmentId: expect.stringMatching(/^apt_/),
      conversationId: expect.stringMatching(/^conv_/),
      service: 'haircut',
      startsAt: '2026-12-01T10:00:00Z',
    });
    expect(JSON.stringify(created.json)).not.toContain('carla');
    expect(await deliveredTo(otherSalonSubscription.result?.['id'], 0)).toEqual([]);

    const appointmentId = (created.json?.['data'] as { appointmentId: string }).appointmentId;
    const replied = await receptionist.tools.call('reply_to_customer', { appointmentId, message: 'See you then!' });
    expect(replied).toBeSuccessful();
    const [reply] = await deliveredTo(customerReplies.result?.['id'], 2);

    expect(reply.json?.['data']).toEqual({
      appointmentId,
      conversationId: (created.json?.['data'] as { conversationId: string }).conversationId,
      message: 'See you then!',
    });
    expect(await deliveredTo(otherCustomerReplies.result?.['id'], 0)).toEqual([]);
  });

  it('refuses a reply about an appointment of another business', async () => {
    const otherSalon = await connectAs('olga', { roles: ['receptionist'], tenantId: 'salon-b' });
    const customer = await connectAs('erin');
    const booked = await customer.tools.call('book_appointment', {
      businessId: 'salon-a',
      service: 'colour',
      startsAt: '2026-12-02T10:00:00Z',
    });
    const { appointmentId } = booked.json<{ appointmentId: string }>();

    const reply = await otherSalon.tools.call('reply_to_customer', { appointmentId, message: 'Hello' });

    expect(reply).toBeError();
  });
});
