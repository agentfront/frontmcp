/**
 * Smoke test of the mail triage example: a subscription starts a watcher of its owner's mailbox, the classifier drops
 * unimportant mail, and important mail reaches the owner of the mailbox only.
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

describe('Mail triage example', () => {
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
      project: 'demo-e2e-events-mail-triage',
      command: 'npx tsx apps/e2e/demo-e2e-events-mail-triage/src/main.ts',
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

  /** A client signed in as `sub`, disconnected after the tests. */
  async function connectAs(sub: string): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  /** One JSON-RPC request of a client, answered as it is. */
  async function rpc(client: McpTestClient, method: string, params: Record<string, unknown>): Promise<RpcReply> {
    const reply = await client.raw.request({ jsonrpc: '2.0', id: `mail-${nextRequestId++}`, method, params });
    return reply as RpcReply;
  }

  /** The subjects of the delivered messages, in order. */
  function subjectsOf(deliveries: ReceivedWebhook[]): unknown[] {
    return deliveries.map((delivery) => (delivery.json?.['data'] as { subject: string }).subject);
  }

  /** The deliveries of a subscription, once `count` arrived in all and a moment passed for any extra one. */
  async function deliveredTo(subscriptionId: unknown, count: number): Promise<ReceivedWebhook[]> {
    await receiver.waitForDeliveries(count, 10_000).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return receiver.deliveries().filter((delivery) => delivery.subscriptionId === subscriptionId);
  }

  it('watches the mailbox of each subscriber and delivers its important mail to it alone', async () => {
    const alice = await connectAs('alice');
    const bob = await connectAs('bob');
    const aliceSubscription = await rpc(alice, 'events/subscribe', {
      name: 'email.important',
      delivery: { url: receiver.url, secret },
    });
    const bobSubscription = await rpc(bob, 'events/subscribe', {
      name: 'email.important',
      delivery: { url: receiver.url, secret },
    });

    const watched = await alice.tools.call('simulate_incoming_mail', {
      to: 'alice',
      from: 'ops@example.com',
      subject: 'Outage in the EU region',
    });
    await alice.tools.call('simulate_incoming_mail', {
      to: 'alice',
      from: 'news@example.com',
      subject: 'Weekly digest',
    });
    await alice.tools.call('simulate_incoming_mail', { to: 'bob', from: 'cfo@board.example.com', subject: 'Q4 plan' });

    const forAlice = await deliveredTo(aliceSubscription.result?.['id'], 2);
    const forBob = await deliveredTo(bobSubscription.result?.['id'], 2);

    expect(watched.json<{ watchers: number }>().watchers).toBe(1);
    expect(subjectsOf(forAlice)).toEqual(['Outage in the EU region']);
    expect(forAlice[0].json?.['data']).toEqual({
      messageId: expect.stringMatching(/^msg_/),
      from: 'ops@example.com',
      subject: 'Outage in the EU region',
    });
    expect(subjectsOf(forBob)).toEqual(['Q4 plan']);
    expect(receiver.deliveries().every((delivery) => delivery.signatureCheck === 'valid')).toBe(true);
  });

  it('stops watching a mailbox when its subscription ends', async () => {
    const carol = await connectAs('carol');
    await rpc(carol, 'events/subscribe', { name: 'email.important', delivery: { url: receiver.url, secret } });
    const before = await carol.tools.call('simulate_incoming_mail', {
      to: 'carol',
      from: 'x@example.com',
      subject: 'Hi',
    });

    await rpc(carol, 'events/unsubscribe', { name: 'email.important', delivery: { url: receiver.url } });
    const after = await carol.tools.call('simulate_incoming_mail', {
      to: 'carol',
      from: 'x@example.com',
      subject: 'Hi',
    });

    expect(before.json<{ watchers: number }>().watchers).toBe(1);
    expect(after.json<{ watchers: number }>().watchers).toBe(0);
  });
});
