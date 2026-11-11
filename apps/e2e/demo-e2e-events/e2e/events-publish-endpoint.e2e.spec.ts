/**
 * E2E tests for the HTTP publish endpoint of MCP Events: another service publishes with a signed request, or with
 * the bearer credentials of the MCP endpoint, and a subscribed receiver gets the delivery.
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
import { bytesToHex, generateStandardWebhookSecret, hmacSha256, randomBytes } from '@frontmcp/utils';

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface PublishAnswer {
  status: number;
  body: Record<string, unknown>;
}

const encoder = new TextEncoder();
const PUBLISH_SECRET = bytesToHex(randomBytes(32));

describe('Events publish endpoint E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let oauthEnv: Record<string, string>;
  let receiver: WebhookReceiver;
  const webhookSecret = generateStandardWebhookSecret();
  const clients: McpTestClient[] = [];
  const subscribed: Array<{ client: McpTestClient; region: string }> = [];
  let nextRequestId = 1;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: oauthInfo.issuer, audience: oauthInfo.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();
    oauthEnv = { IDP_PROVIDER_URL: finalOauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer };

    receiver = new WebhookReceiver({ secrets: [webhookSecret] });
    await receiver.start();
  }, 60000);

  afterEach(async () => {
    for (const { client, region } of subscribed.splice(0)) {
      await client.raw.request({
        jsonrpc: '2.0',
        id: `events-${nextRequestId++}`,
        method: 'events/unsubscribe',
        params: { name: 'order.created', arguments: { region }, delivery: { url: receiver.url } },
      });
    }
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    receiver.clear();
  });

  afterAll(async () => {
    if (receiver) await receiver.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  function startServer(env: Record<string, string>): Promise<TestServer> {
    return TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: { ...oauthEnv, ...env },
      startupTimeout: 30000,
      debug: false,
    });
  }

  /** Subscribes `sub` to order.created for one region, so each test has a subscription of its own. */
  async function subscribeAs(server: TestServer, sub: string, region: string): Promise<string> {
    const token = await tokenFactory.createTestToken({ sub, claims: { roles: [] } });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    const reply = (await client.raw.request({
      jsonrpc: '2.0',
      id: `events-${nextRequestId++}`,
      method: 'events/subscribe',
      params: {
        name: 'order.created',
        arguments: { region },
        delivery: { url: receiver.url, secret: webhookSecret },
      },
    })) as RpcReply;
    if (reply.error) throw new Error(`events/subscribe failed: ${reply.error.message}`);
    subscribed.push({ client, region });
    return reply.result?.['id'] as string;
  }

  async function post(server: TestServer, body: string, headers: Record<string, string>): Promise<PublishAnswer> {
    const response = await fetch(`${server.info.baseUrl}/events/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  /** Signs a request as any service can, without the SDK: HMAC-SHA256 of `<timestamp>.<body>` with the secret. */
  function signature(body: string, secret = PUBLISH_SECRET): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = bytesToHex(hmacSha256(encoder.encode(secret), encoder.encode(`${timestamp}.${body}`)));
    return { 'x-frontmcp-timestamp': timestamp, 'x-frontmcp-signature': `v1=${digest}` };
  }

  /** Waits long enough for a delivery that should not come to have come. */
  async function quietDeliveries(): Promise<ReceivedWebhook[]> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return receiver.deliveries();
  }

  describe('with events.publishEndpoint.secret', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startServer({ EVENTS_PUBLISH_SECRET: PUBLISH_SECRET });
    }, 60000);

    afterAll(async () => {
      if (server) await server.stop();
    });

    it('delivers an event a signed request publishes to a subscribed receiver', async () => {
      const subscriptionId = await subscribeAs(server, 'ada', 'signed');
      const body = JSON.stringify({ name: 'order.created', data: { orderId: 'o-1', status: 'paid', total: 42 } });

      const answer = await post(server, body, signature(body));

      expect(answer.status).toBe(202);
      expect(answer.body).toEqual({ eventId: expect.stringMatching(/^evt_/), matched: 1 });
      const [delivery] = await receiver.waitForDeliveries(1);
      expect(delivery.signatureCheck).toBe('valid');
      expect(delivery.subscriptionId).toBe(subscriptionId);
      expect(delivery.json).toEqual({
        eventId: answer.body['eventId'],
        name: 'order.created',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        data: { orderId: 'o-1', status: 'paid', total: 42 },
      });
    });

    it('refuses an unsigned request and one signed with another secret, and delivers nothing', async () => {
      await subscribeAs(server, 'bob', 'unsigned');
      const body = JSON.stringify({ name: 'order.created', data: { orderId: 'o-2', status: 'paid', total: 1 } });

      const unsigned = await post(server, body, {});
      const forged = await post(server, body, signature(body, bytesToHex(randomBytes(32))));

      expect(unsigned.status).toBe(401);
      expect(forged.status).toBe(401);
      expect(await quietDeliveries()).toHaveLength(0);
    });

    it('publishes a repeated eventId once and answers the repeat like the first request', async () => {
      await subscribeAs(server, 'carol', 'repeat');
      const body = JSON.stringify({
        name: 'order.created',
        data: { orderId: 'o-3', status: 'paid', total: 3 },
        eventId: 'upstream-order-3',
        timestamp: '2026-10-02T12:00:00Z',
      });

      const first = await post(server, body, signature(body));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const repeat = await post(server, body, signature(body));

      expect(first.status).toBe(202);
      expect(first.body).toEqual({ eventId: 'upstream-order-3', matched: 1 });
      expect(repeat.status).toBe(202);
      expect(repeat.body).toEqual(first.body);
      await receiver.waitForDeliveries(1);
      const deliveries = await quietDeliveries();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].json).toMatchObject({ eventId: 'upstream-order-3', timestamp: '2026-10-02T12:00:00.000Z' });
    });

    it('answers an unknown event with 404, data that does not fit the schema with 422 and broken JSON with 400', async () => {
      const unknown = JSON.stringify({ name: 'order.cancelled', data: {} });
      const misfit = JSON.stringify({ name: 'order.created', data: { orderId: 'o-4', status: 'paid', total: 'free' } });
      const broken = '{"name":"order.created",';

      const notFound = await post(server, unknown, signature(unknown));
      const invalid = await post(server, misfit, signature(misfit));
      const malformed = await fetch(`${server.info.baseUrl}/events/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signature(broken) },
        body: broken,
      });

      expect(malformed.status).toBe(400);
      expect(notFound.status).toBe(404);
      expect(invalid.status).toBe(422);
      expect(invalid.body['issues']).toEqual([{ path: 'total', message: expect.any(String) }]);
      expect(JSON.stringify(invalid.body)).not.toContain('free');
    });
  });

  describe('with bearer credentials and events.publishEndpoint.authorities', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startServer({ EVENTS_PUBLISH_BEARER: 'admin' });
    }, 60000);

    afterAll(async () => {
      if (server) await server.stop();
    });

    async function bearer(sub: string, roles: string[]): Promise<Record<string, string>> {
      const token = await tokenFactory.createTestToken({ sub, claims: { roles } });
      return { authorization: `Bearer ${token}` };
    }

    it('publishes for a caller the authorities allow', async () => {
      const subscriptionId = await subscribeAs(server, 'dave', 'bearer');
      const body = JSON.stringify({ name: 'order.created', data: { orderId: 'o-5', status: 'paid', total: 5 } });

      const answer = await post(server, body, await bearer('backend', ['admin']));

      expect(answer.status).toBe(202);
      expect(answer.body['matched']).toBe(1);
      const [delivery] = await receiver.waitForDeliveries(1);
      expect(delivery.subscriptionId).toBe(subscriptionId);
      expect(delivery.json?.['data']).toEqual({ orderId: 'o-5', status: 'paid', total: 5 });
    });

    it('refuses a caller the authorities do not allow with 403, and an anonymous one with 401', async () => {
      await subscribeAs(server, 'erin', 'refused');
      const body = JSON.stringify({ name: 'order.created', data: { orderId: 'o-6', status: 'paid', total: 6 } });

      const member = await post(server, body, await bearer('frank', ['member']));
      const anonymous = await post(server, body, {});

      expect(member.status).toBe(403);
      expect(anonymous.status).toBe(401);
      expect(await quietDeliveries()).toHaveLength(0);
    });
  });
});
