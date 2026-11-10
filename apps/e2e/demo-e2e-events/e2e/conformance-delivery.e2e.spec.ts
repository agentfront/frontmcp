/**
 * Conformance of webhook delivery (MCP Events, SEP-3415): endpoint verification, the Standard Webhooks request,
 * retries, non-retryable answers, redirects, the delivery status, and the `gap` and `terminated` control envelopes.
 * See CONFORMANCE.md for the rows each covers.
 */
import { expect, WebhookReceiver, type McpTestClient, type ReceivedWebhook } from '@frontmcp/testing';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import {
  ConformanceServer,
  delay,
  echoChallenge,
  ISO_TIMESTAMP,
  isWebhookPost,
  ScriptedCallback,
  waitUntil,
  type RpcReply,
} from './conformance.helpers';

const WEBHOOK_ID = /^[A-Za-z0-9_-]+$/;

describe('Events conformance: webhook delivery', () => {
  let conformance: ConformanceServer;
  let receiver: WebhookReceiver;
  let operator: McpTestClient;
  const secret = generateStandardWebhookSecret();
  const scripted: ScriptedCallback[] = [];
  let topicCount = 0;

  beforeAll(async () => {
    receiver = new WebhookReceiver({ secrets: [secret] });
    await receiver.start();
    conformance = await ConformanceServer.start({ EVENTS_MAX_PER_PRINCIPAL: '100' });
  }, 60000);

  beforeEach(async () => {
    receiver.clear();
    receiver.failNext(0);
    operator = await conformance.connect('operator');
    await conformance.control(operator, 'conformance_upstream', { action: 'reset' });
  });

  afterEach(async () => {
    await Promise.all(scripted.splice(0).map((callback) => callback.stop()));
    await conformance.closeAll();
  });

  afterAll(async () => {
    if (conformance) await conformance.stop();
    if (receiver) await receiver.stop();
  });

  /** A topic no other test publishes to. */
  function freshTopic(): string {
    topicCount += 1;
    return `delivery-topic-${topicCount}`;
  }

  /** A started callback that answers as a test scripts it. */
  async function startScripted(answer: ConstructorParameters<typeof ScriptedCallback>[0]): Promise<ScriptedCallback> {
    const callback = new ScriptedCallback(answer);
    await callback.start();
    scripted.push(callback);
    return callback;
  }

  /** Subscribe a caller by webhook to an event, by default `conformance.emitted` for a topic. */
  async function subscribe(client: McpTestClient, params: Record<string, unknown>): Promise<RpcReply> {
    return conformance.rpc(client, 'events/subscribe', {
      name: 'conformance.emitted',
      delivery: { mode: 'webhook', url: receiver.url, secret },
      cursor: null,
      ...params,
    });
  }

  /** Publish occurrences of `conformance.emitted` for a topic. */
  async function emit(topic: string, count = 1): Promise<void> {
    await conformance.control(operator, 'conformance_emit', { topic, count });
  }

  /** The requests the receiver got for one subscription. */
  function requestsOf(subscriptionId: unknown): ReceivedWebhook[] {
    return receiver.requests.filter((request) => request.subscriptionId === subscriptionId);
  }

  it('verifies the callback with a signed challenge before it delivers anything', async () => {
    const client = await conformance.connect('ada');
    const topic = freshTopic();

    const created = await subscribe(client, { arguments: { topic } });
    await emit(topic);
    await receiver.waitForDeliveries(1);

    const [verification, delivery] = requestsOf(created.result?.['id']);
    expect(verification).toMatchObject({
      kind: 'verification',
      signatureCheck: 'valid',
      webhookId: expect.stringMatching(/^msg_verification_[A-Za-z0-9_-]+$/),
      webhookTimestamp: expect.stringMatching(/^\d{10}$/),
      json: { type: 'verification', challenge: expect.any(String) },
    });
    expect(delivery).toMatchObject({ kind: 'event', answeredStatus: 200 });
  });

  it('POSTs each event as JSON with the Standard Webhooks headers, the subscription id and a valid signature', async () => {
    const client = await conformance.connect('bob');
    const callback = await startScripted(echoChallenge);
    const topic = freshTopic();
    const created = await subscribe(client, { arguments: { topic } });
    await subscribe(client, {
      arguments: { topic },
      delivery: { mode: 'webhook', url: callback.url(), secret },
    });

    await emit(topic, 2);
    await receiver.waitForDeliveries(2);
    await waitUntil(() => callback.requests.filter(isWebhookPost).length === 3);

    const deliveries = requestsOf(created.result?.['id']).filter((request) => request.kind === 'event');
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery).toMatchObject({
        signatureCheck: 'valid',
        webhookId: expect.stringMatching(WEBHOOK_ID),
        webhookTimestamp: expect.stringMatching(/^\d{10}$/),
        webhookSignature: expect.stringMatching(/^v1,/),
        subscriptionId: created.result?.['id'],
        json: {
          eventId: expect.any(String),
          name: 'conformance.emitted',
          timestamp: expect.stringMatching(ISO_TIMESTAMP),
          data: { seq: expect.any(Number), topic },
        },
      });
      expect(delivery.json?.['type']).toBeUndefined();
      expect(delivery.webhookId).not.toBe(delivery.json?.['eventId']);
      expect(Buffer.byteLength(delivery.body)).toBeLessThanOrEqual(256 * 1024);
    }
    expect(new Set(deliveries.map((delivery) => delivery.webhookId)).size).toBe(2);
    for (const request of callback.requests.filter(isWebhookPost)) {
      expect(request.method).toBe('POST');
      expect(request.headers['content-type']).toContain('application/json');
    }
  });

  it('retries a failed delivery with the same webhook-id and a newly signed attempt, up to its last attempt', async () => {
    const client = await conformance.connect('carol');
    const topic = freshTopic();
    const created = await subscribe(client, { arguments: { topic } });
    receiver.failNext(10, 503);

    await emit(topic);
    await delay(2000);
    receiver.failNext(0);

    const attempts = requestsOf(created.result?.['id']).filter((request) => request.kind === 'event');
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts.map((attempt) => attempt.webhookId)).size).toBe(1);
    expect(attempts.every((attempt) => attempt.signatureCheck === 'valid' && attempt.answeredStatus === 503)).toBe(
      true,
    );
    const stamps = attempts.map((attempt) => Number(attempt.webhookTimestamp));
    expect(stamps).toEqual([...stamps].sort((first, second) => first - second));
  });

  it.each([410, 413])(
    'drops a delivery the callback answers with %d without a retry, reports http_4xx, and keeps delivering',
    async (status) => {
      const client = await conformance.connect(`dave-${status}`);
      const topic = freshTopic();
      const params = { arguments: { topic } };
      const created = await subscribe(client, params);
      receiver.failNext(1, status);

      await emit(topic);
      await delay(800);
      const refreshed = await subscribe(client, params);
      await emit(topic);
      await receiver.waitForDeliveries(2);

      const [refused, delivered] = requestsOf(created.result?.['id']).filter((request) => request.kind === 'event');
      expect(refused.answeredStatus).toBe(status);
      expect(delivered).toMatchObject({ answeredStatus: 200 });
      expect(delivered.webhookId).not.toBe(refused.webhookId);
      expect(refreshed.result?.['deliveryStatus']).toMatchObject({ active: true, lastError: 'http_4xx' });
    },
  );

  it('refuses a callback that does not echo the challenge with CallbackEndpointError, and repeats nothing it answered', async () => {
    const client = await conformance.connect('erin');
    const callback = await startScripted(() => ({
      status: 200,
      body: { challenge: 'not-the-nonce', detail: 'internal-detail-of-the-endpoint' },
    }));

    const refused = await subscribe(client, {
      arguments: { topic: freshTopic() },
      delivery: { mode: 'webhook', url: callback.url(), secret },
    });

    expect(refused.error).toMatchObject({ code: -32027, data: { reason: 'challenge_failed' } });
    expect(JSON.stringify(refused.error)).not.toMatch(/not-the-nonce|internal-detail-of-the-endpoint/);
  });

  it('refuses a callback nobody listens on with CallbackEndpointError connection_refused', async () => {
    const client = await conformance.connect('erin');
    const callback = await startScripted(echoChallenge);
    const url = callback.url();
    await callback.stop();

    const refused = await subscribe(client, {
      arguments: { topic: freshTopic() },
      delivery: { mode: 'webhook', url, secret },
    });

    expect(refused.error).toMatchObject({ code: -32027, data: { reason: 'connection_refused' } });
  });

  it('follows no redirect, neither for the challenge nor for a delivery', async () => {
    const client = await conformance.connect('frank');
    const redirect = { status: 302, headers: { location: receiver.url } };
    const redirectsAll = await startScripted(() => redirect);
    const redirectsEvents = await startScripted((request) =>
      !isWebhookPost(request) || JSON.parse(request.body).type === 'verification' ? echoChallenge(request) : redirect,
    );
    const topic = freshTopic();

    const refused = await subscribe(client, {
      arguments: { topic },
      delivery: { mode: 'webhook', url: redirectsAll.url(), secret },
    });
    const accepted = await subscribe(client, {
      arguments: { topic },
      delivery: { mode: 'webhook', url: redirectsEvents.url(), secret },
    });
    await emit(topic);
    await waitUntil(() => redirectsEvents.requests.filter(isWebhookPost).length >= 2);
    await delay(300);

    expect(refused.error?.code).toBe(-32027);
    expect(accepted.error).toBeUndefined();
    expect(receiver.requests).toHaveLength(0);
  });

  it('verifies a callback once for a caller, and again for another caller', async () => {
    const ada = await conformance.connect('grace');
    const eve = await conformance.connect('heidi');

    await subscribe(ada, { arguments: { topic: freshTopic() } });
    await subscribe(ada, { arguments: { topic: freshTopic() } });
    const forAda = receiver.verifications().length;
    await subscribe(eve, { arguments: { topic: freshTopic() } });

    expect(forAda).toBe(1);
    expect(receiver.verifications()).toHaveLength(2);
  });

  it('sends a signed gap envelope with a fresh cursor when the upstream skipped events', async () => {
    const client = await conformance.connect('ivan');
    const created = await subscribe(client, { name: 'conformance.replayed', arguments: {} });

    await conformance.control(operator, 'conformance_upstream', { action: 'gap' });
    await conformance.control(operator, 'conformance_upstream', { action: 'append' });
    await waitUntil(() => receiver.requests.some((request) => request.kind === 'gap'));

    const gap = receiver.requests.find((request) => request.kind === 'gap');
    expect(gap).toMatchObject({
      signatureCheck: 'valid',
      subscriptionId: created.result?.['id'],
      webhookId: expect.stringMatching(/^msg_gap_[A-Za-z0-9_-]+$/),
      webhookTimestamp: expect.stringMatching(/^\d{10}$/),
      json: { type: 'gap', cursor: expect.any(String) },
    });
    expect(gap?.json?.['cursor']).not.toBe(created.result?.['cursor']);
  });

  it('ends the subscription of an owner who lost access with a signed terminated envelope, and delivers nothing after', async () => {
    const client = await conformance.connect('judy');
    const params = { name: 'conformance.guarded', arguments: {} };
    const created = await subscribe(client, params);

    await conformance.control(operator, 'conformance_revoke', { sub: 'judy' });
    await delay(400);
    await conformance.control(operator, 'conformance_emit', { event: 'conformance.guarded' });
    await waitUntil(() => receiver.requests.some((request) => request.kind === 'terminated'));
    await conformance.control(operator, 'conformance_emit', { event: 'conformance.guarded' });
    await delay(300);
    const refused = await subscribe(client, params);
    await conformance.control(operator, 'conformance_revoke', { sub: 'judy', revoked: false });

    const sent = requestsOf(created.result?.['id']);
    expect(sent.map((request) => request.kind)).toEqual(['verification', 'terminated']);
    expect(sent[1]).toMatchObject({
      signatureCheck: 'valid',
      webhookId: expect.stringMatching(/^msg_terminated_[A-Za-z0-9_-]+$/),
      json: { type: 'terminated', error: { code: -32024, message: expect.any(String), data: expect.any(Object) } },
    });
    expect(refused.error?.code).toBe(-32024);
  });
});
