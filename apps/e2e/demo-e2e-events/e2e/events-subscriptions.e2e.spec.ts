/**
 * E2E tests for MCP Events subscriptions (SEP-3415): the capability, `events/list`, `events/subscribe` and
 * `events/unsubscribe`, against a real server in transparent auth mode and a local webhook receiver.
 */
import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  WebhookReceiver,
} from '@frontmcp/testing';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

const EVENTS_EXTENSION = 'io.modelcontextprotocol/events';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

describe('Events subscriptions E2E', () => {
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
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.ts',
      env: { IDP_PROVIDER_URL: finalOauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  beforeEach(() => {
    receiver.clear();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
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

  async function connectAnonymously(): Promise<McpTestClient> {
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  async function rpc(client: McpTestClient, method: string, params: Record<string, unknown>): Promise<RpcReply> {
    const reply = await client.raw.request({ jsonrpc: '2.0', id: `events-${nextRequestId++}`, method, params });
    return reply as RpcReply;
  }

  function subscription(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { name: 'order.created', arguments: { status }, delivery: { url: receiver.url, secret }, ...overrides };
  }

  function grantedMs(reply: RpcReply): number {
    return Date.parse(reply.result?.['refreshBefore'] as string) - Date.now();
  }

  describe('capability', () => {
    it('is advertised at initialize, top-level and as the SEP-3415 extension', async () => {
      const client = await connectAs('ada');
      const capabilities = client.capabilities as Record<string, unknown>;

      expect(capabilities['events']).toEqual({});
      expect((capabilities['extensions'] as Record<string, unknown>)[EVENTS_EXTENSION]).toEqual({});
    });

    it('is advertised by server/discover in both forms', async () => {
      const client = await connectAs('ada');

      const discovered = await client.discover();
      const capabilities = discovered.capabilities as Record<string, unknown>;

      expect(capabilities['events']).toEqual({});
      expect((capabilities['extensions'] as Record<string, unknown>)[EVENTS_EXTENSION]).toEqual({});
    });
  });

  describe('events/list', () => {
    it('lists the webhook events a caller may subscribe to', async () => {
      const member = await connectAs('bob', ['member']);
      const admin = await connectAs('ada', ['admin']);

      const forMember = await rpc(member, 'events/list', {});
      const forAdmin = await rpc(admin, 'events/list', {});

      expect(forMember.result?.['events']).toEqual([
        expect.objectContaining({
          name: 'order.created',
          description: 'Fires when an order is placed',
          delivery: ['webhook'],
          inputSchema: expect.objectContaining({ type: 'object' }),
          payloadSchema: expect.objectContaining({ required: ['orderId', 'status', 'total'] }),
        }),
      ]);
      expect((forAdmin.result?.['events'] as Array<{ name: string }>).map((definition) => definition.name)).toEqual([
        'audit.logged',
        'order.created',
      ]);
    });
  });

  describe('events/subscribe', () => {
    it('verifies the callback once and answers with a deterministic id and the granted lifetime', async () => {
      const client = await connectAs('carol');

      const created = await rpc(client, 'events/subscribe', subscription('paid'));

      expect(created.error).toBeUndefined();
      expect(created.result).toMatchObject({ cursor: null, truncated: false });
      expect(created.result?.['id']).toMatch(/^sub_[0-9a-f]{32}$/);
      expect(Math.abs(grantedMs(created) - 60 * MINUTE_MS)).toBeLessThan(MINUTE_MS);

      const verifications = receiver.verifications();
      expect(verifications).toHaveLength(1);
      expect(verifications[0]).toMatchObject({
        signatureCheck: 'valid',
        subscriptionId: created.result?.['id'],
        json: { type: 'verification', challenge: expect.any(String) },
      });
      expect(verifications[0].webhookId).toMatch(/^msg_verification_/);
    });

    it('is idempotent: a repeat, and the same arguments in another key order, are the same subscription', async () => {
      const client = await connectAs('dave');
      const first = await rpc(
        client,
        'events/subscribe',
        subscription('x', { arguments: { status: 'paid', region: 'eu' } }),
      );

      const repeated = await rpc(
        client,
        'events/subscribe',
        subscription('x', { arguments: { status: 'paid', region: 'eu' } }),
      );
      const reordered = await rpc(
        client,
        'events/subscribe',
        subscription('x', { arguments: { region: 'eu', status: 'paid' } }),
      );

      expect(repeated.result?.['id']).toBe(first.result?.['id']);
      expect(reordered.result?.['id']).toBe(first.result?.['id']);
      expect(repeated.result?.['deliveryStatus']).toEqual({
        active: true,
        lastDeliveryAt: null,
        lastError: null,
        failedSince: null,
      });
      expect(receiver.verifications()).toHaveLength(1);
    });

    it('gives another caller, and other arguments, another subscription', async () => {
      const erin = await connectAs('erin');
      const frank = await connectAs('frank');

      const mine = await rpc(erin, 'events/subscribe', subscription('paid'));
      const theirs = await rpc(frank, 'events/subscribe', subscription('paid'));
      const other = await rpc(erin, 'events/subscribe', subscription('refunded'));

      const ids = [mine.result?.['id'], theirs.result?.['id'], other.result?.['id']];
      expect(new Set(ids).size).toBe(3);
    });

    it('clamps the requested lifetime to the minimum and the maximum, and grants no endless one in memory', async () => {
      const client = await connectAs('grace');

      const short = await rpc(client, 'events/subscribe', subscription('short', { ttlMs: 1000 }));
      const long = await rpc(client, 'events/subscribe', subscription('long', { ttlMs: 30 * DAY_MS }));
      const endless = await rpc(client, 'events/subscribe', subscription('endless', { ttlMs: null }));

      expect(Math.abs(grantedMs(short) - MINUTE_MS)).toBeLessThan(10_000);
      expect(Math.abs(grantedMs(long) - DAY_MS)).toBeLessThan(MINUTE_MS);
      expect(endless.result?.['refreshBefore']).not.toBeNull();
      expect(Math.abs(grantedMs(endless) - DAY_MS)).toBeLessThan(MINUTE_MS);
    });

    it('accepts a refresh with a new secret without verifying the callback again', async () => {
      const client = await connectAs('heidi');
      const first = await rpc(client, 'events/subscribe', subscription('rotation'));
      const rotatedSecret = generateStandardWebhookSecret();
      receiver.addSecret(rotatedSecret);

      const rotated = await rpc(
        client,
        'events/subscribe',
        subscription('rotation', { delivery: { url: receiver.url, secret: rotatedSecret } }),
      );

      expect(rotated.error).toBeUndefined();
      expect(rotated.result?.['id']).toBe(first.result?.['id']);
      expect(receiver.verifications()).toHaveLength(1);
    });

    it('refuses a callback that does not echo the challenge', async () => {
      const client = await connectAs('ivan');
      receiver.echoChallenges(false);

      const refused = await rpc(client, 'events/subscribe', subscription('silent'));
      receiver.echoChallenges(true);

      expect(refused.error).toMatchObject({ code: -32027, data: { reason: 'challenge_failed' } });
    });

    it('refuses arguments, a secret and a callback that are not valid with InvalidParams', async () => {
      const client = await connectAs('judy');

      const badArguments = await rpc(client, 'events/subscribe', subscription('x', { arguments: { status: 7 } }));
      const badSecret = await rpc(
        client,
        'events/subscribe',
        subscription('x', { delivery: { url: receiver.url, secret: 'short' } }),
      );
      const badCallback = await rpc(
        client,
        'events/subscribe',
        subscription('x', { delivery: { url: 'ftp://hooks.example.com/mcp', secret } }),
      );

      expect(badArguments.error?.code).toBe(-32602);
      expect(badSecret.error?.code).toBe(-32602);
      expect(badCallback.error?.code).toBe(-32602);
      expect(receiver.requests).toHaveLength(0);
    });

    it('refuses an anonymous caller', async () => {
      const client = await connectAnonymously();

      const refused = await rpc(client, 'events/subscribe', subscription('anonymous'));

      expect(refused.error?.code).toBe(-32024);
      expect(receiver.requests).toHaveLength(0);
    });
  });

  describe('dialects', () => {
    const guarded = { name: 'audit.logged' };

    it('answers a client detected as OpenAI with the codes of the design sketch', async () => {
      const client = await connectAs('kim', ['member'], 'openai');

      const unknown = await rpc(client, 'events/subscribe', subscription('x', { name: 'order.refunded' }));
      const forbidden = await rpc(client, 'events/subscribe', subscription('x', { ...guarded, arguments: {} }));
      const unsupported = await rpc(
        client,
        'events/subscribe',
        subscription('x', { delivery: { mode: 'poll', url: receiver.url, secret } }),
      );

      expect(unknown.error?.code).toBe(-32011);
      expect(forbidden.error?.code).toBe(-32012);
      expect(unsupported.error?.code).toBe(-32014);
    });

    it('answers any other client with the codes of SEP-3415', async () => {
      const client = await connectAs('lee', ['member']);

      const unknown = await rpc(client, 'events/subscribe', subscription('x', { name: 'order.refunded' }));
      const forbidden = await rpc(client, 'events/subscribe', subscription('x', { ...guarded, arguments: {} }));
      const unsupported = await rpc(
        client,
        'events/subscribe',
        subscription('x', { delivery: { mode: 'poll', url: receiver.url, secret } }),
      );

      expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event' } });
      expect(forbidden.error?.code).toBe(-32024);
      expect(unsupported.error).toMatchObject({ code: -32026, data: { feature: 'deliveryMode', value: 'poll' } });
    });

    it('lets a caller the authorities allow subscribe to the guarded event', async () => {
      const admin = await connectAs('mia', ['admin']);

      const allowed = await rpc(admin, 'events/subscribe', subscription('x', { ...guarded, arguments: {} }));

      expect(allowed.error).toBeUndefined();
    });
  });

  describe('events/unsubscribe', () => {
    it('removes the subscription, succeeds again when it is gone, and lets it be created anew', async () => {
      const client = await connectAs('nora');
      const key = { name: 'order.created', arguments: { status: 'removal' }, delivery: { url: receiver.url } };
      const first = await rpc(client, 'events/subscribe', subscription('removal'));

      const removed = await rpc(client, 'events/unsubscribe', key);
      const again = await rpc(client, 'events/unsubscribe', key);
      const recreated = await rpc(client, 'events/subscribe', subscription('removal'));

      expect(removed.result).toEqual({});
      expect(again.result).toEqual({});
      expect(recreated.result?.['id']).toBe(first.result?.['id']);
      expect(recreated.result?.['deliveryStatus']).toBeUndefined();
    });

    it('refuses an anonymous caller', async () => {
      const client = await connectAnonymously();

      const refused = await rpc(client, 'events/unsubscribe', {
        name: 'order.created',
        delivery: { url: receiver.url },
      });

      expect(refused.error?.code).toBe(-32024);
    });
  });
});
