import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { generateStandardWebhookSecret, signingKeyOf, verifyWebhookSignature } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, Plugin, type FlowCtxOf } from '../../common';
import { EventDeliverHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventDeliveryOutcome, type EventDeliveryRecord } from '../delivery/event-outbox';
import { SUSPEND_AFTER_FAILURES } from '../flows/event-deliver.flow';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const SECRET = generateStandardWebhookSecret();
const OLD_SECRET = generateStandardWebhookSecret();
const BODY = JSON.stringify({
  eventId: 'evt_1',
  name: 'order.created',
  timestamp: '2026-11-10T10:00:00.000Z',
  data: {},
});

const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string().optional() } });
const attempts = jest.fn();

@Plugin({ name: 'delivery-audit' })
class DeliveryAuditPlugin {
  @EventDeliverHook.Did('classify')
  recordAttempt(ctx: FlowCtxOf<'events:deliver'>) {
    attempts(ctx.state.required.outcome.result);
  }
}

@App({ id: 'shop', name: 'Shop', events: [orderCreated] })
class ShopApp {}

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('events:deliver', () => {
  let scope: Scope;
  let receiver: http.Server;
  let callback: string;
  let answerWith = 200;
  const received: Received[] = [];
  let nextSubscription = 1;

  function subscriptions(): EventSubscriptions {
    return scope.events?.subscriptions as EventSubscriptions;
  }

  async function storedSubscription(
    overrides: Partial<EventSubscriptionRecord> = {},
  ): Promise<EventSubscriptionRecord> {
    const now = Date.now();
    const record: EventSubscriptionRecord = {
      id: `sub_${String(nextSubscription++).padStart(4, '0')}`,
      principalKey: 'principal:ada',
      subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} },
      eventName: 'order.created',
      arguments: {},
      argumentsKey: '{}',
      delivery: { mode: 'webhook', url: callback, secret: SECRET },
      dialect: 'sep-3415',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 3_600_000,
      verifiedAt: now,
      lastAuthorizedAt: now,
      active: true,
      status: {},
      ...overrides,
    };
    await subscriptions().store.upsert(record);
    return record;
  }

  function deliveryTo(subscriptionId: string, overrides: Partial<EventDeliveryRecord> = {}): EventDeliveryRecord {
    const now = Date.now();
    return {
      id: 'dlv_0001',
      kind: 'event',
      subscriptionId,
      eventName: 'order.created',
      body: BODY,
      webhookId: 'msg_stored',
      attempt: 0,
      nextAttemptAt: now,
      firstAttemptAt: now,
      leaseOwner: 'spec',
      leaseUntil: now + 60_000,
      ...overrides,
    };
  }

  function deliver(delivery: EventDeliveryRecord): Promise<EventDeliveryOutcome> {
    return scope.runFlowForOutput('events:deliver', { delivery });
  }

  beforeAll(async () => {
    receiver = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(answerWith).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    callback = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/mcp`;

    const { instance } = await createTestFetchServer({
      info: { name: 'event-deliver-flow', version: '1.0.0' },
      apps: [ShopApp],
      plugins: [DeliveryAuditPlugin],
      auth: { mode: 'local' } as never,
      events: { webhook: { unsafeAllowLocalCallbacks: true, delivery: { timeoutMs: 2000 } } },
    });
    scope = instance.getScopes()[0] as Scope;
  });

  beforeEach(() => {
    received.length = 0;
    answerWith = 200;
    attempts.mockClear();
  });

  afterAll(async () => {
    await scope.dispose();
    await new Promise((resolve) => receiver.close(resolve));
  });

  describe('an acknowledged delivery', () => {
    it('sends the stored body unchanged, signed, with the subscription id', async () => {
      const subscription = await storedSubscription();
      const before = Math.floor(Date.now() / 1000);

      const outcome = await deliver(deliveryTo(subscription.id));

      expect(outcome).toEqual({ result: 'delivered' });
      expect(received).toHaveLength(1);
      const { headers, body } = received[0];
      expect(body).toBe(BODY);
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-mcp-subscription-id']).toBe(subscription.id);
      expect(headers['webhook-id']).toBe('msg_stored');
      expect(Number(headers['webhook-timestamp'])).toBeGreaterThanOrEqual(before);
      expect(
        verifyWebhookSignature(
          {
            id: headers['webhook-id'] as string,
            timestamp: headers['webhook-timestamp'] as string,
            signature: headers['webhook-signature'] as string,
            body,
          },
          [signingKeyOf(SECRET)],
        ),
      ).toBe('valid');
    });

    it('records the delivery and clears an earlier failure', async () => {
      const subscription = await storedSubscription({
        status: { lastError: 'http_5xx', failedSince: 1000, failures: 3 },
      });
      const before = Date.now();

      await deliver(deliveryTo(subscription.id));

      const stored = await subscriptions().store.get(subscription.id);
      expect(stored?.status).toEqual({ lastDeliveryAt: expect.any(Number) });
      expect(stored?.status.lastDeliveryAt).toBeGreaterThanOrEqual(before);
    });

    it('signs with the replaced secret too, while its grace runs', async () => {
      const rotating = await storedSubscription({
        delivery: {
          mode: 'webhook',
          url: callback,
          secret: SECRET,
          previousSecret: OLD_SECRET,
          previousSecretUntil: Date.now() + 60_000,
        },
      });
      const rotated = await storedSubscription({
        delivery: {
          mode: 'webhook',
          url: callback,
          secret: SECRET,
          previousSecret: OLD_SECRET,
          previousSecretUntil: Date.now() - 1,
        },
      });

      await deliver(deliveryTo(rotating.id));
      await deliver(deliveryTo(rotated.id));

      const signaturesDuringGrace = String(received[0].headers['webhook-signature']).split(' ');
      const signaturesAfterGrace = String(received[1].headers['webhook-signature']).split(' ');
      expect(signaturesDuringGrace).toHaveLength(2);
      expect(signaturesAfterGrace).toHaveLength(1);
      for (const secret of [SECRET, OLD_SECRET]) {
        const check = verifyWebhookSignature(
          {
            id: received[0].headers['webhook-id'] as string,
            timestamp: received[0].headers['webhook-timestamp'] as string,
            signature: received[0].headers['webhook-signature'] as string,
            body: received[0].body,
          },
          [signingKeyOf(secret)],
        );
        expect(check).toBe('valid');
      }
    });

    it('signs each attempt with a fresh timestamp', async () => {
      const subscription = await storedSubscription();
      jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout'] });

      await deliver(deliveryTo(subscription.id));
      jest.setSystemTime(Date.now() + 5000);
      await deliver(deliveryTo(subscription.id));
      jest.useRealTimers();

      const [first, second] = received.map((request) => Number(request.headers['webhook-timestamp']));
      expect(second - first).toBe(5);
      expect(received[0].headers['webhook-id']).toBe(received[1].headers['webhook-id']);
      expect(received[0].headers['webhook-signature']).not.toBe(received[1].headers['webhook-signature']);
    });
  });

  describe('a refused delivery', () => {
    it.each([410, 413])('is dropped without a retry when the callback answers %d', async (status) => {
      const subscription = await storedSubscription();
      answerWith = status;

      const outcome = await deliver(deliveryTo(subscription.id));

      expect(outcome).toEqual({ result: 'dropped', reason: 'refused' });
      const stored = await subscriptions().store.get(subscription.id);
      expect(stored?.status).toEqual({ lastError: 'http_4xx' });
      expect(stored?.active).toBe(true);
    });
  });

  describe('a failed delivery', () => {
    it.each([
      [500, 'http_5xx'],
      [404, 'http_4xx'],
      [302, 'http_4xx'],
    ])('answers failed with the category for a %d', async (status, category) => {
      const subscription = await storedSubscription();
      answerWith = status;
      const before = Date.now();

      const outcome = await deliver(deliveryTo(subscription.id));

      expect(outcome).toEqual({ result: 'failed', category });
      const stored = await subscriptions().store.get(subscription.id);
      expect(stored?.status).toEqual({ lastError: category, failedSince: expect.any(Number), failures: 1 });
      expect(stored?.status.failedSince).toBeGreaterThanOrEqual(before);
    });

    it('answers failed for a callback nobody listens on', async () => {
      const closed = http.createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const { port } = closed.address() as AddressInfo;
      await new Promise((resolve) => closed.close(resolve));
      const subscription = await storedSubscription({
        delivery: { mode: 'webhook', url: `http://127.0.0.1:${port}/hooks/mcp`, secret: SECRET },
      });

      await expect(deliver(deliveryTo(subscription.id))).resolves.toEqual({
        result: 'failed',
        category: 'connection_refused',
      });
    });

    it('keeps the time of the first failure and counts the failures in a row', async () => {
      const subscription = await storedSubscription({
        status: { failedSince: 1000, failures: 4, lastError: 'timeout' },
      });
      answerWith = 503;

      await deliver(deliveryTo(subscription.id));

      await expect(subscriptions().store.get(subscription.id)).resolves.toMatchObject({
        status: { lastError: 'http_5xx', failedSince: 1000, failures: 5 },
      });
    });

    it('suspends the subscription at the twentieth failure in a row, and waits from then on', async () => {
      const subscription = await storedSubscription({
        status: { failedSince: 1000, failures: SUSPEND_AFTER_FAILURES - 1 },
      });
      answerWith = 500;
      const before = Date.now();

      const failing = await deliver(deliveryTo(subscription.id));
      const sentBeforeWaiting = received.length;
      const waiting = await deliver(deliveryTo(subscription.id));

      expect(failing).toEqual({ result: 'failed', category: 'http_5xx' });
      expect(waiting).toEqual({ result: 'waiting' });
      expect(received).toHaveLength(sentBeforeWaiting);
      const stored = await subscriptions().store.get(subscription.id);
      expect(stored?.active).toBe(false);
      expect(stored?.status.failures).toBe(SUSPEND_AFTER_FAILURES);
      expect(stored?.status.suspendedSince).toBeGreaterThanOrEqual(before);
    });
  });

  describe('a delivery without a live subscription', () => {
    it('is dropped when the subscription is gone', async () => {
      await expect(deliver(deliveryTo('sub_missing'))).resolves.toEqual({ result: 'dropped', reason: 'gone' });
      expect(received).toHaveLength(0);
    });

    it('sends a terminated envelope to the target it carries, and changes no subscription', async () => {
      const envelope = JSON.stringify({ type: 'terminated', error: { code: -32024, message: 'Forbidden', data: {} } });
      const delivery = deliveryTo('sub_removed', {
        kind: 'terminated',
        body: envelope,
        webhookId: 'msg_terminated_1',
        target: { url: callback, secret: SECRET },
      });

      const delivered = await deliver(delivery);
      answerWith = 500;
      const failed = await deliver(delivery);

      expect(delivered).toEqual({ result: 'delivered' });
      expect(failed).toEqual({ result: 'failed', category: 'http_5xx' });
      expect(received[0].body).toBe(envelope);
      expect(received[0].headers['webhook-id']).toBe('msg_terminated_1');
      expect(received[0].headers['x-mcp-subscription-id']).toBe('sub_removed');
    });
  });

  it('runs the hooks of a plugin on each attempt', async () => {
    const subscription = await storedSubscription();

    await deliver(deliveryTo(subscription.id));

    expect(attempts).toHaveBeenCalledWith('delivered');
  });
});
