/**
 * E2E tests for where events come from besides a tool: a worker on a timer, a duty and a worker that watches a
 * folder each publish to a subscribed receiver, and a published event starts the workflow that listens to it on the
 * server's event bus.
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
} from '@frontmcp/testing';
import { generateStandardWebhookSecret, mkdir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

describe('Events sources E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  let receiver: WebhookReceiver;
  let directory: string;
  let inbox: string;
  const secret = generateStandardWebhookSecret();
  const clients: McpTestClient[] = [];
  const subscribed: Array<{ client: McpTestClient; name: string; args: Record<string, unknown> }> = [];
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

    directory = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-sources-'));
    inbox = path.join(directory, 'inbox');
    await mkdir(inbox);

    server = await TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.sources.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
        EVENTS_INBOX_DIR: inbox,
        // The duty's lease lives in a folder of this run's own, so no other server on the machine holds it
        FRONTMCP_HOME: path.join(directory, 'home'),
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterEach(async () => {
    for (const { client, name, args } of subscribed.splice(0)) {
      await client.raw.request({
        jsonrpc: '2.0',
        id: `events-${nextRequestId++}`,
        method: 'events/unsubscribe',
        params: { name, arguments: args, delivery: { url: receiver.url } },
      });
    }
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    receiver.clear();
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (receiver) await receiver.stop();
    if (mockOAuth) await mockOAuth.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  /** Connects a client that is signed in as `sub`. */
  async function connectAs(sub: string): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub, claims: { roles: [] } });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  /** Subscribes the client's caller to an event, with the test's receiver as callback. */
  async function subscribe(client: McpTestClient, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const reply = (await client.raw.request({
      jsonrpc: '2.0',
      id: `events-${nextRequestId++}`,
      method: 'events/subscribe',
      params: { name, arguments: args, delivery: { url: receiver.url, secret } },
    })) as RpcReply;
    if (reply.error) throw new Error(`events/subscribe failed: ${reply.error.message}`);
    subscribed.push({ client, name, args });
    return reply.result?.['id'] as string;
  }

  it('delivers the events a worker publishes on a timer', async () => {
    const client = await connectAs('ada');
    const subscriptionId = await subscribe(client, 'clock.ticked', { source: 'worker' });

    const deliveries = await receiver.waitForDeliveries(3, 15_000);

    expect(deliveries.every((delivery) => delivery.signatureCheck === 'valid')).toBe(true);
    expect(deliveries.every((delivery) => delivery.subscriptionId === subscriptionId)).toBe(true);
    const ticks = deliveries.map((delivery) => delivery.json?.['data'] as { source: string; tick: number });
    expect(ticks.every((tick) => tick.source === 'worker')).toBe(true);
    expect(new Set(ticks.map((tick) => tick.tick)).size).toBe(3);
  });

  it('delivers the events a duty publishes at its interval', async () => {
    const client = await connectAs('bob');
    await subscribe(client, 'clock.ticked', { source: 'duty' });

    const deliveries = await receiver.waitForDeliveries(2, 15_000);

    const ticks = deliveries.map((delivery) => delivery.json?.['data'] as { source: string; tick: number });
    expect(ticks.every((tick) => tick.source === 'duty')).toBe(true);
    expect(ticks[1].tick).toBeGreaterThan(ticks[0].tick);
  });

  it('delivers an event for a file that appears in the folder a worker watches', async () => {
    const client = await connectAs('carol');
    await subscribe(client, 'file.added');

    await writeFile(path.join(inbox, 'invoice-7.pdf'), 'pdf');

    const [delivery] = await receiver.waitForDeliveries(1, 15_000);
    expect(delivery.signatureCheck).toBe('valid');
    expect(delivery.json).toMatchObject({ name: 'file.added', data: { name: 'invoice-7.pdf' } });
  });

  it('starts the workflow that listens to a published event, also when nobody is subscribed', async () => {
    const client = await connectAs('dave');

    const published = await client.tools.call('place-order', { orderId: 'o-bridge', status: 'paid', total: 12 });

    expect(published).toBeSuccessful();
    const { eventId } = published.json<{ eventId: string; matched: number }>();
    const deadline = Date.now() + 10_000;
    let recorded: Array<Record<string, unknown>> = [];
    while (recorded.length === 0 && Date.now() < deadline) {
      const result = await client.tools.call('recorded-occurrences', {});
      recorded = result.json<{ occurrences: Array<Record<string, unknown>> }>().occurrences;
      if (recorded.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(recorded).toEqual([
      {
        eventId,
        name: 'order.created',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        data: { orderId: 'o-bridge', status: 'paid', total: 12 },
      },
    ]);
  });
});
