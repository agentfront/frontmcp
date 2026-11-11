/**
 * E2E tests for webhook delivery of an event with `check()`: the server reads the upstream for each webhook
 * subscription and delivers what it finds, with a watermark cursor a client can persist.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  WebhookReceiver,
  type ReceivedWebhook,
} from '@frontmcp/testing';
import { base64urlEncode, generateStandardWebhookSecret, mkdtemp, randomBytes, rm } from '@frontmcp/utils';

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

describe('Events replay over webhook E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let receiver: WebhookReceiver;
  let directory: string;
  let serverEnv: Record<string, string>;
  let server: TestServer | undefined;
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

    directory = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-replay-'));
    serverEnv = {
      IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
      IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
      EVENTS_NEXT_POLL_MS: '200',
      EVENTS_SQLITE_PATH: path.join(directory, 'events.sqlite'),
      EVENTS_TICKETS_FILE: path.join(directory, 'tickets.json'),
      // A value made for this run: the store refuses to keep webhook secrets without one
      MCP_EVENTS_SECRET: base64urlEncode(randomBytes(32)),
    };
    server = await startServer();
  }, 60000);

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (receiver) await receiver.stop();
    if (mockOAuth) await mockOAuth.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function startServer(): Promise<TestServer> {
    return TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: serverEnv,
      startupTimeout: 30000,
      debug: false,
    });
  }

  async function connect(): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub: 'ada', claims: { roles: [] } });
    const client = await McpTestClient.create({
      baseUrl: (server as TestServer).info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  async function subscribe(
    client: McpTestClient,
    queue: string,
    extra: Record<string, unknown> = {},
  ): Promise<RpcReply> {
    const reply = await client.raw.request({
      jsonrpc: '2.0',
      id: `replay-${nextRequestId++}`,
      method: 'events/subscribe',
      params: { name: 'ticket.updated', arguments: { queue }, delivery: { url: receiver.url, secret }, ...extra },
    });
    return reply as RpcReply;
  }

  async function deliveredTo(subscriptionId: unknown, count: number): Promise<ReceivedWebhook[]> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const mine = receiver.deliveries().filter((delivery) => delivery.subscriptionId === subscriptionId);
      if (mine.length >= count) return mine;
      if (Date.now() > deadline) throw new Error(`${mine.length} of ${count} deliveries arrived`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  function ticketIdsOf(deliveries: ReceivedWebhook[]): unknown[] {
    return deliveries.map((delivery) => (delivery.json?.['data'] as { ticketId: string }).ticketId);
  }

  it('delivers a ticket change made after subscribing, with a cursor in the body', async () => {
    const client = await connect();
    const subscribed = await subscribe(client, 'billing');
    const startCursor = subscribed.result?.['cursor'];

    await client.tools.call('update-ticket', { ticketId: 't-1', queue: 'billing' });
    const [delivery] = await deliveredTo(subscribed.result?.['id'], 1);

    expect(subscribed.error).toBeUndefined();
    expect(startCursor).toEqual(expect.any(String));
    expect(subscribed.result?.['truncated']).toBe(false);
    expect(delivery.signatureCheck).toBe('valid');
    expect(delivery.json).toEqual({
      eventId: expect.stringMatching(/^evt_/),
      name: 'ticket.updated',
      timestamp: expect.any(String),
      data: { ticketId: 't-1', queue: 'billing' },
      cursor: startCursor,
    });
  });

  it('answers a refresh with the watermark, past what the callback acknowledged', async () => {
    const client = await connect();
    const subscribed = await subscribe(client, 'refresh');
    await client.tools.call('update-ticket', { ticketId: 't-2', queue: 'refresh' });
    await deliveredTo(subscribed.result?.['id'], 1);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const refreshed = await subscribe(client, 'refresh');

    expect(refreshed.result?.['id']).toBe(subscribed.result?.['id']);
    expect(Number(refreshed.result?.['cursor'])).toBeGreaterThan(Number(subscribed.result?.['cursor']));
    expect(refreshed.result?.['truncated']).toBe(false);
  });

  it('replays from an old cursor for a subscription created with one', async () => {
    const client = await connect();
    const before = await subscribe(client, 'position-probe');
    await client.tools.call('update-ticket', { ticketId: 't-3', queue: 'replayed' });
    await client.tools.call('update-ticket', { ticketId: 't-4', queue: 'replayed' });

    const subscribed = await subscribe(client, 'replayed', { cursor: before.result?.['cursor'] });
    const replayed = await deliveredTo(subscribed.result?.['id'], 2);

    expect(ticketIdsOf(replayed)).toEqual(['t-3', 't-4']);
  });

  it('resumes after a restart without losing or repeating what was acknowledged', async () => {
    const before = await connect();
    const subscribed = await subscribe(before, 'restart');
    const subscriptionId = subscribed.result?.['id'];
    await before.tools.call('update-ticket', { ticketId: 't-5', queue: 'restart' });
    await deliveredTo(subscriptionId, 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await before.disconnect();
    clients.length = 0;
    await (server as TestServer).stop();

    server = await startServer();
    const after = await connect();
    await after.tools.call('update-ticket', { ticketId: 't-6', queue: 'restart' });
    const deliveries = await deliveredTo(subscriptionId, 2);
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(ticketIdsOf(await deliveredTo(subscriptionId, 2))).toEqual(['t-5', 't-6']);
    expect(deliveries.every((delivery) => delivery.signatureCheck === 'valid')).toBe(true);
  }, 120_000);
});
