import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { EVENTS_ERROR_CODES } from '@frontmcp/protocol';
import { generateStandardWebhookSecret, signingKeyOf, verifyWebhookSignature } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  Event,
  event,
  EventContext,
  Plugin,
  type EventSubscriber,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../common';
import { EventForbiddenError, EventNotRegisteredError, InvalidEventPublishError, PublicMcpError } from '../../errors';
import { EventPublishHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { isAuthorizeRefusal, subscriberAuthInfo } from '../event-reauthorization';
import { EVENT_DELIVERY_MAX_BYTES, isInAudience } from '../flows/event-publish.flow';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const SECRET = generateStandardWebhookSecret();
const codesOfSep = EVENTS_ERROR_CODES;
const HOUR_MS = 3_600_000;
const orderPayload = { orderId: z.string(), status: z.string(), note: z.string().optional() };

const onUnsubscribe = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: orderPayload,
  match(occurrence, args) {
    if (args.status === 'explode') throw new Error('match failed');
    return args.status === undefined || args.status === occurrence.data.status;
  },
  transform(occurrence, args, subscriber) {
    if (args.status === 'broken') throw new Error('transform failed');
    if (args.status === 'shapeless') return { nothing: true } as never;
    return { ...occurrence, data: { ...occurrence.data, note: `for ${subscriber.sub}` } };
  },
});

@Event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } })
class OrderShipped extends EventContext<Record<string, never>, { orderId: string }> {}

const auditLogged = event({
  name: 'audit.logged',
  payloadSchema: { action: z.string() },
  authorities: 'admin',
  onUnsubscribe,
});

const bulkExported = event({ name: 'bulk.exported', payloadSchema: { blob: z.string() } });

const vaultAuthorize = jest.fn();
const vaultSeenBy = jest.fn();

/** Guarded twice: the admin profile, then its own `authorize()`. */
const vaultOpened = event({
  name: 'vault.opened',
  inputSchema: { vault: z.string().optional() },
  payloadSchema: { vaultId: z.string() },
  authorities: 'admin',
  authorize(args, subscriber) {
    vaultSeenBy(this.authInfo);
    return vaultAuthorize(args, subscriber);
  },
  onUnsubscribe,
});

const noteAuthorize = jest.fn();

/** Guarded by its own `authorize()` only. */
const noteShared = event({
  name: 'note.shared',
  payloadSchema: { noteId: z.string() },
  authorize: noteAuthorize,
  onUnsubscribe,
});

const published = jest.fn();

@Plugin({ name: 'publish-audit' })
class PublishAuditPlugin {
  @EventPublishHook.Did('match')
  recordMatches(ctx: FlowCtxOf<'events:publish'>) {
    published(ctx.state.required.deliveries.length);
  }
}

@App({
  id: 'shop',
  name: 'Shop',
  events: [orderCreated, OrderShipped, auditLogged, bulkExported, vaultOpened, noteShared],
})
class ShopApp {}

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
  json: Record<string, unknown>;
}

const owner = (sub: string, overrides: Partial<EventSubscriber> = {}): EventSubscriber => ({
  sub,
  roles: [],
  permissions: [],
  scopes: [],
  claims: {},
  ...overrides,
});

describe('isInAudience', () => {
  const ada = owner('ada', { tenantId: 'acme', roles: ['admin', 'editor'] });

  it('takes every owner without an audience', () => {
    expect(isInAudience(undefined, ada)).toBe(true);
    expect(isInAudience({}, ada)).toBe(true);
  });

  it.each([
    ['the owner by subject', { sub: 'ada' }, true],
    ['one of several subjects', { sub: ['bob', 'ada'] }, true],
    ['another subject', { sub: 'bob' }, false],
    ['the tenant', { tenantId: 'acme' }, true],
    ['one of several tenants', { tenantId: ['globex', 'acme'] }, true],
    ['another tenant', { tenantId: 'globex' }, false],
    ['one of the roles', { roles: { any: ['viewer', 'editor'] } }, true],
    ['none of the roles', { roles: { any: ['viewer'] } }, false],
    ['every role', { roles: { all: ['admin', 'editor'] } }, true],
    ['a role that is missing', { roles: { all: ['admin', 'owner'] } }, false],
    ['any and all together', { roles: { any: ['editor'], all: ['admin'] } }, true],
    ['subject and tenant together', { sub: 'ada', tenantId: 'globex' }, false],
  ])('matches %s', (_label, audience, expected) => {
    expect(isInAudience(audience, ada)).toBe(expected);
  });

  it('leaves out an owner without a tenant when the audience names one', () => {
    expect(isInAudience({ tenantId: 'acme' }, owner('bob'))).toBe(false);
  });
});

describe('isAuthorizeRefusal', () => {
  it('takes a public error as a refusal and anything else as a check that could not be made', () => {
    expect(isAuthorizeRefusal(new EventForbiddenError(codesOfSep, 'vault.opened', 'closed'))).toBe(true);
    expect(isAuthorizeRefusal(new PublicMcpError('no'))).toBe(true);
    expect(isAuthorizeRefusal(new Error('ECONNRESET'))).toBe(false);
    expect(isAuthorizeRefusal('a string')).toBe(false);
  });
});

describe('subscriberAuthInfo', () => {
  it('rebuilds the auth of a stored owner without an issuer it did not have', () => {
    expect(subscriberAuthInfo(owner('bob', { scopes: ['read'], claims: { roles: ['member'] } }))).toEqual({
      clientId: 'bob',
      scopes: ['read'],
      extra: { user: { roles: ['member'], sub: 'bob' } },
    });
  });
});

describe('events:publish', () => {
  let scope: Scope;
  let receiver: http.Server;
  let callback: string;
  const received: Received[] = [];
  let nextSubscription = 1;

  function subscriptions(): EventSubscriptions {
    return scope.events?.subscriptions as EventSubscriptions;
  }

  function publisher() {
    const eventPublisher = scope.events?.publisher;
    if (!eventPublisher) throw new Error('the scope has no publisher');
    return eventPublisher;
  }

  async function subscribed(overrides: Partial<EventSubscriptionRecord> = {}): Promise<EventSubscriptionRecord> {
    const now = Date.now();
    const record: EventSubscriptionRecord = {
      id: `sub_${String(nextSubscription++).padStart(4, '0')}`,
      principalKey: 'principal:ada',
      subscriber: owner('ada'),
      eventName: 'order.created',
      arguments: {},
      argumentsKey: '{}',
      delivery: { mode: 'webhook', url: callback, secret: SECRET },
      dialect: 'sep-3415',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + HOUR_MS,
      verifiedAt: now,
      lastAuthorizedAt: now,
      active: true,
      status: {},
      ...overrides,
    };
    await subscriptions().store.upsert(record);
    return record;
  }

  async function deliveries(count: number): Promise<Received[]> {
    const deadline = Date.now() + 5000;
    while (received.length < count) {
      if (Date.now() > deadline) throw new Error(`${received.length} of ${count} deliveries arrived`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return received;
  }

  /** Waits long enough for a delivery that should not come to have come. */
  async function settled(): Promise<Received[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return received;
  }

  async function removeAll(): Promise<void> {
    const store = subscriptions().store;
    const eventNames = [
      'order.created',
      'order.shipped',
      'audit.logged',
      'bulk.exported',
      'vault.opened',
      'note.shared',
    ];
    for (const eventName of eventNames) {
      for (const record of await store.listByEvent(eventName)) await store.delete(record.id);
    }
  }

  async function startScope(extra: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
    const { instance } = await createTestFetchServer({
      info: { name: 'event-publish-flow', version: '1.0.0' },
      apps: [ShopApp],
      auth: { mode: 'local' } as never,
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      events: { webhook: { unsafeAllowLocalCallbacks: true } },
      ...extra,
    });
    return instance.getScopes()[0] as Scope;
  }

  beforeAll(async () => {
    receiver = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        received.push({ headers: request.headers, body, json: JSON.parse(body) });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    callback = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/mcp`;
    scope = await startScope({ plugins: [PublishAuditPlugin] });
  });

  beforeEach(async () => {
    await removeAll();
    received.length = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await scope.dispose();
    await new Promise((resolve) => receiver.close(resolve));
  });

  describe('publishing', () => {
    it('delivers one signed occurrence to a subscription of the event', async () => {
      const subscription = await subscribed();
      const before = Date.now();

      const result = await publisher().publish(orderCreated, { orderId: 'o-1', status: 'paid' });

      expect(result).toEqual({ eventId: expect.stringMatching(/^evt_[A-Za-z0-9_-]{24}$/), matched: 1 });
      const [delivery] = await deliveries(1);
      expect(delivery.json).toEqual({
        eventId: result.eventId,
        name: 'order.created',
        timestamp: expect.any(String),
        data: { orderId: 'o-1', status: 'paid', note: 'for ada' },
      });
      expect(Date.parse(delivery.json['timestamp'] as string)).toBeGreaterThanOrEqual(before);
      expect(delivery.headers['x-mcp-subscription-id']).toBe(subscription.id);
      expect(
        verifyWebhookSignature(
          {
            id: delivery.headers['webhook-id'] as string,
            timestamp: delivery.headers['webhook-timestamp'] as string,
            signature: delivery.headers['webhook-signature'] as string,
            body: delivery.body,
          },
          [signingKeyOf(SECRET)],
        ),
      ).toBe('valid');
    });

    it('hands its deliveries to the outbox together, not one after the other', async () => {
      await subscribed();
      await subscribed();
      const outbox = scope.events?.outbox;
      if (!outbox) throw new Error('the scope has no outbox');
      const release: Array<() => void> = [];
      const enqueue = jest
        .spyOn(outbox, 'enqueue')
        .mockImplementation(() => new Promise<string>((resolve) => release.push(() => resolve('dlv_test'))));

      const publishing = publisher().publish(orderCreated, { orderId: 'o-9', status: 'paid' });
      const deadline = Date.now() + 2000;
      while (enqueue.mock.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(enqueue).toHaveBeenCalledTimes(2);
      for (const done of release) done();
      await expect(publishing).resolves.toMatchObject({ matched: 2 });
      enqueue.mockRestore();
    });

    it('takes the event by name and by its class', async () => {
      await subscribed({ eventName: 'order.shipped' });

      const byName = await publisher().publish('order.shipped', { orderId: 'o-2' });
      const byClass = await publisher().publish(OrderShipped, { orderId: 'o-3' });

      expect(byName.matched).toBe(1);
      expect(byClass.matched).toBe(1);
      const orderIds = (await deliveries(2)).map((delivery) => (delivery.json['data'] as { orderId: string }).orderId);
      expect(orderIds.sort()).toEqual(['o-2', 'o-3']);
    });

    it('uses the id and the time it is given', async () => {
      await subscribed({ eventName: 'order.shipped' });

      const withDate = await publisher().publish(
        OrderShipped,
        { orderId: 'o-4' },
        { eventId: 'evt_upstream_42', timestamp: new Date('2026-10-01T12:00:00+02:00') },
      );
      await publisher().publish(OrderShipped, { orderId: 'o-5' }, { timestamp: '2026-10-02T08:30:00Z' });

      expect(withDate.eventId).toBe('evt_upstream_42');
      const timestamps = (await deliveries(2)).map((delivery) => delivery.json['timestamp']);
      expect(timestamps.sort()).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-02T08:30:00.000Z']);
    });

    it('answers matched 0 when nobody is subscribed', async () => {
      await expect(publisher().publish(OrderShipped, { orderId: 'o-6' })).resolves.toMatchObject({ matched: 0 });
      expect(await settled()).toHaveLength(0);
    });

    it('refuses an event the server does not have', async () => {
      const unknown = event({ name: 'order.refunded', payloadSchema: { orderId: z.string() } });

      await expect(publisher().publish('order.refunded', {})).rejects.toThrow(EventNotRegisteredError);
      await expect(publisher().publish(unknown, { orderId: 'o-7' })).rejects.toThrow(
        'Event "order.refunded" is not registered, so it cannot be published. List it in the `events` of an app.',
      );
    });

    it('refuses data that does not match the payload schema, and a time that is not one', async () => {
      const badData = publisher().publish('order.shipped', { orderId: 7 });

      await expect(badData).rejects.toThrow(InvalidEventPublishError);
      await expect(badData).rejects.toThrow(
        'Event "order.shipped" cannot be published: its data does not match payloadSchema',
      );
      await expect(publisher().publish(OrderShipped, { orderId: 'o-8' }, { timestamp: 'yesterday' })).rejects.toThrow(
        'Event "order.shipped" cannot be published: "yesterday" is not a timestamp',
      );
    });
  });

  describe('the webhook-id', () => {
    it('is a message id of its own for a SEP-3415 subscription, and the event id for a sketch one', async () => {
      const sep = await subscribed({ eventName: 'order.shipped', dialect: 'sep-3415' });
      const sketch = await subscribed({ eventName: 'order.shipped', dialect: 'sketch' });

      const { eventId } = await publisher().publish(OrderShipped, { orderId: 'o-9' });

      const all = await deliveries(2);
      const idOf = (subscriptionId: string) =>
        all.find((delivery) => delivery.headers['x-mcp-subscription-id'] === subscriptionId)?.headers['webhook-id'];
      expect(idOf(sketch.id)).toBe(eventId);
      expect(idOf(sep.id)).toMatch(/^msg_[A-Za-z0-9_-]+$/);
      expect(idOf(sep.id)).not.toContain(eventId);
    });
  });

  describe('which subscriptions receive an event', () => {
    it('asks match(), with the arguments of each subscription', async () => {
      const paid = await subscribed({ arguments: { status: 'paid' } });
      await subscribed({ arguments: { status: 'refunded' } });
      const every = await subscribed();

      const result = await publisher().publish(orderCreated, { orderId: 'o-10', status: 'paid' });

      expect(result.matched).toBe(2);
      const receivers = (await deliveries(2)).map((delivery) => delivery.headers['x-mcp-subscription-id']);
      expect(receivers.sort()).toEqual([paid.id, every.id].sort());
      expect(await settled()).toHaveLength(2);
    });

    it('leaves out the one subscription whose match() or transform() throws, or returns no occurrence', async () => {
      const healthy = await subscribed();
      await subscribed({ arguments: { status: 'explode' } });
      await subscribed({ arguments: { status: 'broken' } });
      await subscribed({ arguments: { status: 'shapeless' } });

      const result = await publisher().publish(orderCreated, { orderId: 'o-11', status: 'broken' });
      const shapeless = await publisher().publish(orderCreated, { orderId: 'o-12', status: 'shapeless' });

      expect(result.matched).toBe(1);
      expect(shapeless.matched).toBe(1);
      const all = await deliveries(2);
      expect(all.map((delivery) => delivery.headers['x-mcp-subscription-id'])).toEqual([healthy.id, healthy.id]);
    });

    it('lets transform() shape the event for each owner', async () => {
      await subscribed({ subscriber: owner('ada') });
      await subscribed({ subscriber: owner('bob'), principalKey: 'principal:bob' });

      await publisher().publish(orderCreated, { orderId: 'o-13', status: 'paid' });

      const notes = (await deliveries(2)).map((delivery) => (delivery.json['data'] as { note: string }).note);
      expect(notes.sort()).toEqual(['for ada', 'for bob']);
    });

    it('narrows to the owners the audience names, before match() runs', async () => {
      await subscribed({ subscriber: owner('ada', { tenantId: 'acme', roles: ['admin'] }) });
      const bobs = await subscribed({ subscriber: owner('bob', { tenantId: 'globex', roles: ['member'] }) });

      const byRole = await publisher().publish(
        orderCreated,
        { orderId: 'o-14', status: 'paid' },
        { audience: { roles: { any: ['member'] } } },
      );
      const byTenant = await publisher().publish(
        orderCreated,
        { orderId: 'o-15', status: 'paid' },
        { audience: { tenantId: 'globex' } },
      );
      const nobody = await publisher().publish(
        orderCreated,
        { orderId: 'o-16', status: 'paid' },
        { audience: { sub: 'carol' } },
      );

      expect([byRole.matched, byTenant.matched, nobody.matched]).toEqual([1, 1, 0]);
      const receivers = (await deliveries(2)).map((delivery) => delivery.headers['x-mcp-subscription-id']);
      expect(receivers).toEqual([bobs.id, bobs.id]);
    });

    it('delivers to one subscription only when it is named', async () => {
      const target = await subscribed();
      await subscribed();
      const ofAnotherEvent = await subscribed({ eventName: 'order.shipped' });

      const targeted = await publisher().publish(
        orderCreated,
        { orderId: 'o-17', status: 'paid' },
        { subscriptionId: target.id },
      );
      const mismatched = await publisher().publish(
        orderCreated,
        { orderId: 'o-18', status: 'paid' },
        { subscriptionId: ofAnotherEvent.id },
      );
      const missing = await publisher().publish(
        orderCreated,
        { orderId: 'o-19', status: 'paid' },
        { subscriptionId: 'sub_missing' },
      );

      expect([targeted.matched, mismatched.matched, missing.matched]).toEqual([1, 0, 0]);
      expect((await deliveries(1))[0].headers['x-mcp-subscription-id']).toBe(target.id);
    });

    it('skips a suspended subscription', async () => {
      await subscribed({ active: false, status: { suspendedSince: Date.now() } });

      await expect(publisher().publish(orderCreated, { orderId: 'o-20', status: 'paid' })).resolves.toMatchObject({
        matched: 0,
      });
    });

    it('runs the hooks of a plugin', async () => {
      await subscribed();

      await publisher().publish(orderCreated, { orderId: 'o-21', status: 'paid' });

      expect(published).toHaveBeenCalledWith(1);
    });
  });

  describe('the body limit', () => {
    it('does not deliver an event whose body is over 262144 bytes, and never truncates it', async () => {
      await subscribed({ eventName: 'bulk.exported' });

      const tooLarge = await publisher().publish(bulkExported, { blob: 'x'.repeat(EVENT_DELIVERY_MAX_BYTES) });
      const fitting = await publisher().publish(bulkExported, { blob: 'x'.repeat(EVENT_DELIVERY_MAX_BYTES - 200) });

      expect(tooLarge.matched).toBe(0);
      expect(fitting.matched).toBe(1);
      const [delivery] = await deliveries(1);
      expect(Buffer.byteLength(delivery.body)).toBeLessThanOrEqual(EVENT_DELIVERY_MAX_BYTES);
      expect(await settled()).toHaveLength(1);
    });
  });

  describe('re-authorization', () => {
    const longAgo = () => Date.now() - HOUR_MS;

    it('ends a subscription whose owner the authorities no longer allow, and tells its callback', async () => {
      const revoked = await subscribed({
        eventName: 'audit.logged',
        subscriber: owner('ada', { roles: ['member'] }),
        arguments: { scope: 'all' },
        lastAuthorizedAt: longAgo(),
      });

      const result = await publisher().publish(auditLogged, { action: 'login' });

      expect(result.matched).toBe(0);
      await expect(subscriptions().store.get(revoked.id)).resolves.toBeUndefined();
      expect(onUnsubscribe).toHaveBeenCalledTimes(1);
      expect(onUnsubscribe).toHaveBeenCalledWith(
        { scope: 'all' },
        expect.objectContaining({ id: revoked.id }),
        'terminated',
      );
      const [envelope] = await deliveries(1);
      expect(envelope.json).toEqual({
        type: 'terminated',
        error: { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } },
      });
      expect(envelope.headers['webhook-id']).toMatch(/^msg_terminated_/);
      expect(envelope.headers['x-mcp-subscription-id']).toBe(revoked.id);
      expect(
        verifyWebhookSignature(
          {
            id: envelope.headers['webhook-id'] as string,
            timestamp: envelope.headers['webhook-timestamp'] as string,
            signature: envelope.headers['webhook-signature'] as string,
            body: envelope.body,
          },
          [signingKeyOf(SECRET)],
        ),
      ).toBe('valid');
    });

    it('sends no envelope to a subscription of the sketch dialect', async () => {
      const revoked = await subscribed({
        eventName: 'audit.logged',
        dialect: 'sketch',
        subscriber: owner('ada', { roles: ['member'] }),
        lastAuthorizedAt: longAgo(),
      });

      await publisher().publish(auditLogged, { action: 'login' });

      await expect(subscriptions().store.get(revoked.id)).resolves.toBeUndefined();
      expect(onUnsubscribe).toHaveBeenCalledTimes(1);
      expect(await settled()).toHaveLength(0);
    });

    it('keeps a subscription whose owner is still allowed, and notes when it was checked', async () => {
      const allowed = await subscribed({
        eventName: 'audit.logged',
        subscriber: owner('ada', { roles: ['admin'] }),
        lastAuthorizedAt: longAgo(),
      });
      const before = Date.now();

      const result = await publisher().publish(auditLogged, { action: 'login' });

      expect(result.matched).toBe(1);
      const stored = await subscriptions().store.get(allowed.id);
      expect(stored?.lastAuthorizedAt).toBeGreaterThanOrEqual(before);
      await deliveries(1);
    });

    it('does not check again an owner it checked within reauthorizeEveryMs', async () => {
      await subscribed({
        eventName: 'audit.logged',
        subscriber: owner('ada', { roles: ['member'] }),
        lastAuthorizedAt: Date.now() - 1000,
      });

      await expect(publisher().publish(auditLogged, { action: 'login' })).resolves.toMatchObject({ matched: 1 });
      await deliveries(1);
    });

    describe("the event's authorize()", () => {
      const admin = () => owner('ada', { roles: ['admin'], iss: 'https://auth.example.com', claims: { team: 'ops' } });

      it('is called again with the stored arguments and owner, on a context for that owner', async () => {
        await subscribed({
          eventName: 'vault.opened',
          subscriber: admin(),
          arguments: { vault: 'v-1' },
          lastAuthorizedAt: longAgo(),
        });

        await expect(publisher().publish(vaultOpened, { vaultId: 'v-1' })).resolves.toMatchObject({ matched: 1 });

        expect(vaultAuthorize).toHaveBeenCalledWith({ vault: 'v-1' }, admin());
        expect(vaultSeenBy).toHaveBeenCalledWith(
          expect.objectContaining({
            clientId: 'ada',
            extra: { user: { team: 'ops', sub: 'ada', iss: 'https://auth.example.com' } },
          }),
        );
        await deliveries(1);
      });

      it('ends the subscription when it refuses, as an authorities denial does', async () => {
        const refused = await subscribed({
          eventName: 'vault.opened',
          subscriber: admin(),
          lastAuthorizedAt: longAgo(),
        });
        vaultAuthorize.mockRejectedValueOnce(new EventForbiddenError(codesOfSep, 'vault.opened', 'vault closed'));

        const result = await publisher().publish(vaultOpened, { vaultId: 'v-2' });

        expect(result.matched).toBe(0);
        await expect(subscriptions().store.get(refused.id)).resolves.toBeUndefined();
        expect(onUnsubscribe).toHaveBeenCalledWith({}, expect.objectContaining({ id: refused.id }), 'terminated');
        const [envelope] = await deliveries(1);
        expect(envelope.json).toEqual({
          type: 'terminated',
          error: { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } },
        });
      });

      it('keeps the subscription when it fails, delivers nothing this time, and checks it again next time', async () => {
        const kept = await subscribed({ eventName: 'vault.opened', subscriber: admin(), lastAuthorizedAt: longAgo() });
        vaultAuthorize.mockRejectedValueOnce(new Error('the upstream timed out'));

        const failed = await publisher().publish(vaultOpened, { vaultId: 'v-3' });
        const retried = await publisher().publish(vaultOpened, { vaultId: 'v-4' });

        expect(failed.matched).toBe(0);
        expect(retried.matched).toBe(1);
        expect(vaultAuthorize).toHaveBeenCalledTimes(2);
        expect(onUnsubscribe).not.toHaveBeenCalled();
        await expect(subscriptions().store.get(kept.id)).resolves.toBeDefined();
        const [delivery] = await deliveries(1);
        expect(delivery.json['data']).toEqual({ vaultId: 'v-4' });
      });

      it('is not called within reauthorizeEveryMs of the last check, and is called once it passed', async () => {
        const recent = await subscribed({
          eventName: 'vault.opened',
          subscriber: admin(),
          lastAuthorizedAt: Date.now() - 1000,
        });

        await expect(publisher().publish(vaultOpened, { vaultId: 'v-5' })).resolves.toMatchObject({ matched: 1 });
        expect(vaultAuthorize).not.toHaveBeenCalled();
        await subscriptions().store.update(recent.id, { lastAuthorizedAt: longAgo() });
        await publisher().publish(vaultOpened, { vaultId: 'v-6' });

        expect(vaultAuthorize).toHaveBeenCalledTimes(1);
        await deliveries(2);
      });

      it('runs after the authorities, and not at all for an owner they refuse', async () => {
        const allowed = await subscribed({
          eventName: 'vault.opened',
          subscriber: admin(),
          lastAuthorizedAt: longAgo(),
        });
        const revoked = await subscribed({
          eventName: 'vault.opened',
          subscriber: owner('bob', { roles: ['member'] }),
          lastAuthorizedAt: longAgo(),
        });

        await publisher().publish(vaultOpened, { vaultId: 'v-7' });

        expect(vaultAuthorize).toHaveBeenCalledTimes(1);
        expect(vaultAuthorize).toHaveBeenCalledWith({}, admin());
        await expect(subscriptions().store.get(allowed.id)).resolves.toBeDefined();
        await expect(subscriptions().store.get(revoked.id)).resolves.toBeUndefined();
        const kinds = (await deliveries(2)).map((delivery) => delivery.json['type'] ?? 'event');
        expect(kinds.sort()).toEqual(['event', 'terminated']);
      });

      it('is checked again for an event that has no authorities', async () => {
        const refused = await subscribed({ eventName: 'note.shared', lastAuthorizedAt: longAgo() });
        noteAuthorize.mockRejectedValueOnce(new PublicMcpError('the note was unshared'));

        await publisher().publish(noteShared, { noteId: 'n-1' });

        expect(noteAuthorize).toHaveBeenCalledTimes(1);
        await expect(subscriptions().store.get(refused.id)).resolves.toBeUndefined();
        expect((await deliveries(1))[0].json['type']).toBe('terminated');
      });
    });

    it('neither delivers to nor ends a subscription whose check could not be made', async () => {
      const unchecked = await subscribed({
        eventName: 'audit.logged',
        subscriber: owner('ada', { roles: ['admin'] }),
        lastAuthorizedAt: longAgo(),
      });
      const evaluate = jest.spyOn(scope.authoritiesEngine as never, 'evaluate' as never);
      evaluate.mockRejectedValueOnce(new Error('policy store down') as never);

      const result = await publisher().publish(auditLogged, { action: 'login' });

      expect(result.matched).toBe(0);
      await expect(subscriptions().store.get(unchecked.id)).resolves.toBeDefined();
      evaluate.mockRestore();
    });
  });

  describe('a subscription without expiry that stayed suspended', () => {
    it('is ended once it was suspended for longer than suspendedTtlMs, with a terminated envelope', async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * HOUR_MS;
      const stale = await subscribed({
        eventName: 'order.shipped',
        expiresAt: null,
        active: false,
        status: { suspendedSince: eightDaysAgo, lastError: 'timeout' },
      });
      const recent = await subscribed({
        eventName: 'order.shipped',
        expiresAt: null,
        active: false,
        status: { suspendedSince: Date.now() - HOUR_MS },
      });
      const expiring = await subscribed({
        eventName: 'order.shipped',
        active: false,
        status: { suspendedSince: eightDaysAgo },
      });

      await publisher().publish(OrderShipped, { orderId: 'o-22' });

      await expect(subscriptions().store.get(stale.id)).resolves.toBeUndefined();
      await expect(subscriptions().store.get(recent.id)).resolves.toBeDefined();
      await expect(subscriptions().store.get(expiring.id)).resolves.toBeDefined();
      const [envelope] = await deliveries(1);
      expect(envelope.json).toEqual({
        type: 'terminated',
        error: { code: -32027, message: 'CallbackEndpointError', data: { reason: 'timeout' } },
      });
    });
  });

  describe('on a server that performs no delivery', () => {
    it('publishes to nobody', async () => {
      const idle = await startScope({ events: { webhook: { enabled: false } } });

      await expect(idle.events?.publisher?.publish(OrderShipped, { orderId: 'o-23' })).resolves.toEqual({
        eventId: expect.stringMatching(/^evt_/),
        matched: 0,
      });
      await idle.dispose();
    });
  });
});
