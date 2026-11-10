/**
 * E2E test for delivery across a restart: with subscriptions and the outbox in a SQLite file, a delivery the server
 * could not complete before it stopped is completed by the server that starts next.
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
import { base64urlEncode, generateStandardWebhookSecret, mkdtemp, randomBytes, rm } from '@frontmcp/utils';

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

describe('Events delivery across a restart E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let receiver: WebhookReceiver;
  let directory: string;
  let serverEnv: Record<string, string>;
  let server: TestServer | undefined;
  const secret = generateStandardWebhookSecret();

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

    directory = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-'));
    serverEnv = {
      IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
      IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
      EVENTS_SQLITE_PATH: path.join(directory, 'events.sqlite'),
      EVENTS_BACKOFF_MS: '2000',
      // A value made for this run: the store refuses to keep webhook secrets without one
      MCP_EVENTS_SECRET: base64urlEncode(randomBytes(32)),
    };
  }, 60000);

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

  async function connect(to: TestServer): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub: 'ada', claims: { roles: [] } });
    return McpTestClient.create({
      baseUrl: to.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
  }

  async function subscribe(client: McpTestClient): Promise<RpcReply> {
    const reply = await client.raw.request({
      jsonrpc: '2.0',
      id: 'events-subscribe',
      method: 'events/subscribe',
      params: { name: 'order.created', arguments: { region: 'restart' }, delivery: { url: receiver.url, secret } },
    });
    return reply as RpcReply;
  }

  it('completes a pending delivery after the server restarts, and keeps the subscription', async () => {
    server = await startServer();
    const before = await connect(server);
    const created = await subscribe(before);
    const subscriptionId = created.result?.['id'];
    receiver.failNext(100, 503);

    await before.tools.call('place-order', { orderId: 'o-restart', status: 'paid', total: 7 });
    const [failedAttempt] = await receiver.waitForDeliveries(1);
    await before.disconnect();
    await server.stop();
    const attemptsBeforeRestart = receiver.deliveries().length;
    receiver.failNext(0);

    server = await startServer();
    const attempts = await receiver.waitForDeliveries(attemptsBeforeRestart + 1, 90_000);
    const completed = attempts[attempts.length - 1];

    expect(failedAttempt.answeredStatus).toBe(503);
    expect(completed).toMatchObject({
      answeredStatus: 200,
      signatureCheck: 'valid',
      subscriptionId,
      webhookId: failedAttempt.webhookId,
      body: failedAttempt.body,
    });

    const after = await connect(server);
    const refreshed = await subscribe(after);
    await after.disconnect();

    expect(refreshed.result?.['id']).toBe(subscriptionId);
    expect(refreshed.result?.['deliveryStatus']).toMatchObject({ active: true, lastDeliveryAt: expect.any(String) });
    expect(receiver.verifications()).toHaveLength(1);
  }, 150_000);
});
