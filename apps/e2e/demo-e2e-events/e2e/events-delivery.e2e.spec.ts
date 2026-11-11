/**
 * E2E tests for publishing and webhook delivery of MCP Events: a tool publishes, and a local receiver gets signed
 * deliveries from a real server in transparent auth mode.
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

describe('Events delivery E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  let receiver: WebhookReceiver;
  const secret = generateStandardWebhookSecret();
  const clients: McpTestClient[] = [];
  const subscribed: Array<{ client: McpTestClient; args: Record<string, unknown> }> = [];
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
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: { IDP_PROVIDER_URL: finalOauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterEach(async () => {
    for (const { client, args } of subscribed.splice(0)) await unsubscribe(client, args);
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    receiver.clear();
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (receiver) await receiver.stop();
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

  async function subscribe(
    client: McpTestClient,
    args: Record<string, unknown>,
    secretToUse = secret,
  ): Promise<string> {
    const reply = (await client.raw.request({
      jsonrpc: '2.0',
      id: `events-${nextRequestId++}`,
      method: 'events/subscribe',
      params: { name: 'order.created', arguments: args, delivery: { url: receiver.url, secret: secretToUse } },
    })) as RpcReply;
    if (reply.error) throw new Error(`events/subscribe failed: ${reply.error.message}`);
    subscribed.push({ client, args });
    return reply.result?.['id'] as string;
  }

  async function unsubscribe(client: McpTestClient, args: Record<string, unknown>): Promise<void> {
    await client.raw.request({
      jsonrpc: '2.0',
      id: `events-${nextRequestId++}`,
      method: 'events/unsubscribe',
      params: { name: 'order.created', arguments: args, delivery: { url: receiver.url } },
    });
  }

  /** Waits long enough for a delivery that should not come to have come. */
  async function quietDeliveries(): Promise<ReceivedWebhook[]> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return receiver.deliveries();
  }

  it('delivers one signed occurrence of an event a tool publishes', async () => {
    const client = await connectAs('ada');
    const subscriptionId = await subscribe(client, { region: 'single' });

    const published = await client.tools.call('place-order', { orderId: 'o-1', status: 'paid', total: 42 });

    expect(published).toBeSuccessful();
    const [delivery] = await receiver.waitForDeliveries(1);
    expect(delivery.signatureCheck).toBe('valid');
    expect(delivery.subscriptionId).toBe(subscriptionId);
    expect(delivery.webhookId).toMatch(/^msg_/);
    expect(delivery.json).toEqual({
      eventId: expect.stringMatching(/^evt_/),
      name: 'order.created',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      data: { orderId: 'o-1', status: 'paid', total: 42 },
    });
    expect(await quietDeliveries()).toHaveLength(1);
  });

  it('uses the event id as webhook-id for a subscription a client detected as OpenAI created', async () => {
    const chatgpt = await connectAs('bob', [], 'openai');
    const subscriptionId = await subscribe(chatgpt, { region: 'sketch' });

    await chatgpt.tools.call('place-order', { orderId: 'o-2' });

    const [delivery] = await receiver.waitForDeliveries(1);
    expect(delivery.subscriptionId).toBe(subscriptionId);
    expect(delivery.webhookId).toMatch(/^evt_/);
    expect(delivery.webhookId).toBe(delivery.json?.['eventId']);
  });

  it('does not deliver an event a subscription filters out', async () => {
    const client = await connectAs('carol');
    const refunds = await subscribe(client, { status: 'refunded' });
    const everything = await subscribe(client, { region: 'filter' });

    await client.tools.call('place-order', { orderId: 'o-3', status: 'paid' });

    await receiver.waitForDeliveries(1);
    const receivers = (await quietDeliveries()).map((delivery) => delivery.subscriptionId);
    expect(receivers).toEqual([everything]);
    expect(receivers).not.toContain(refunds);
  });

  it('reaches only the owners with the role an audience names', async () => {
    const admin = await connectAs('dave', ['admin']);
    const member = await connectAs('erin', ['member']);
    const adminSubscription = await subscribe(admin, { region: 'audience' });
    const memberSubscription = await subscribe(member, { region: 'audience' });

    await member.tools.call('place-order', { orderId: 'o-4', audienceRole: 'admin' });

    await receiver.waitForDeliveries(1);
    const receivers = (await quietDeliveries()).map((delivery) => delivery.subscriptionId);
    expect(receivers).toEqual([adminSubscription]);
    expect(receivers).not.toContain(memberSubscription);
  });

  it('retries a delivery the receiver fails, with the same webhook-id and a fresh signature', async () => {
    const client = await connectAs('frank');
    const subscriptionId = await subscribe(client, { region: 'retry' });
    receiver.failNext(2, 503);

    await client.tools.call('place-order', { orderId: 'o-5' });

    const attempts = await receiver.waitForDeliveries(3, 15_000);
    expect(attempts.map((attempt) => attempt.subscriptionId)).toEqual(new Array(3).fill(subscriptionId));
    expect(attempts.map((attempt) => attempt.answeredStatus)).toEqual([503, 503, 200]);
    expect(new Set(attempts.map((attempt) => attempt.webhookId)).size).toBe(1);
    expect(new Set(attempts.map((attempt) => attempt.body)).size).toBe(1);
    expect(attempts.every((attempt) => attempt.signatureCheck === 'valid')).toBe(true);
    const timestamps = attempts.map((attempt) => Number(attempt.webhookTimestamp));
    expect(timestamps[2]).toBeGreaterThanOrEqual(timestamps[0]);

    const refreshed = (await client.raw.request({
      jsonrpc: '2.0',
      id: `events-${nextRequestId++}`,
      method: 'events/subscribe',
      params: { name: 'order.created', arguments: { region: 'retry' }, delivery: { url: receiver.url, secret } },
    })) as RpcReply;
    expect(refreshed.result?.['deliveryStatus']).toMatchObject({
      active: true,
      lastError: null,
      failedSince: null,
      lastDeliveryAt: expect.any(String),
    });
  });

  it('signs with the old and the new secret after a refresh replaced it', async () => {
    const client = await connectAs('grace');
    const subscriptionId = await subscribe(client, { region: 'rotation' });
    const rotatedSecret = generateStandardWebhookSecret();
    await subscribe(client, { region: 'rotation' }, rotatedSecret);

    await client.tools.call('place-order', { orderId: 'o-6' });

    const [delivery] = await receiver.waitForDeliveries(1);
    expect(delivery.subscriptionId).toBe(subscriptionId);
    expect(delivery.signatureCheck).toBe('valid');
    expect(delivery.webhookSignature?.split(' ')).toHaveLength(2);
  });

  it('stops delivering after events/unsubscribe', async () => {
    const client = await connectAs('heidi');
    await subscribe(client, { region: 'removed' });
    await unsubscribe(client, { region: 'removed' });

    const published = await client.tools.call('place-order', { orderId: 'o-7' });

    expect(published).toBeSuccessful();
    expect(await quietDeliveries()).toHaveLength(0);
  });
});
