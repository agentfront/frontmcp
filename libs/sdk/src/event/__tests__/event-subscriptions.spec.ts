import { createMemoryStorage, getRuntimeContext } from '@frontmcp/utils';

import { type EventEntry } from '../../common';
import { eventsConfigSchema } from '../../common/metadata/event.metadata';
import { StorageEventSubscriptionStore, type EventSubscriptionRecord } from '../subscription/event-subscription.store';
import {
  deliveryStatusOf,
  EventSubscriptions,
  SUBSCRIPTION_SWEEP_INTERVAL_MS,
  subscriptionRefOf,
} from '../subscription/event-subscriptions';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const settings = eventsConfigSchema.parse({}).subscriptions;

interface EventHooks {
  onSubscribe: jest.Mock;
  onUnsubscribe: jest.Mock;
}

function eventNamed(name: string, hooks: Partial<EventHooks> = {}, ttl?: { defaultMs?: number; maxMs?: number }) {
  return { name, metadata: { name, ttl }, create: jest.fn().mockReturnValue(hooks) } as unknown as EventEntry;
}

function subscription(overrides: Partial<EventSubscriptionRecord> = {}): EventSubscriptionRecord {
  return {
    id: 'sub_0001',
    principalKey: 'principal:ada',
    subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} },
    eventName: 'order.created',
    arguments: { status: 'paid' },
    argumentsKey: '{"status":"paid"}',
    delivery: { mode: 'webhook', url: 'https://hooks.example.com/mcp', secret: 'whsec_current' },
    dialect: 'sep-3415',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + HOUR_MS,
    verifiedAt: NOW,
    lastAuthorizedAt: NOW,
    active: true,
    status: {},
    ...overrides,
  };
}

async function subscriptionsFor(
  events: EventEntry[],
  overrides: { durable?: boolean; settings?: typeof settings } = {},
) {
  const storage = createMemoryStorage({ prefix: 'spec:events:' });
  await storage.connect();
  const store = new StorageEventSubscriptionStore({ storage });
  const warn = jest.fn();
  const logger = { child: () => ({ warn }) };
  const subscriptions = new EventSubscriptions({
    events: { findByName: (name) => events.find((event) => event.name === name) },
    store,
    durable: overrides.durable ?? false,
    verifier: {} as never,
    settings: overrides.settings ?? settings,
    rotationGraceMs: 5 * MINUTE_MS,
    logger: logger as never,
  });
  return { subscriptions, store, warn };
}

describe('EventSubscriptions', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.mocked(getRuntimeContext).mockReset();
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);
  });

  describe('identityOf', () => {
    it('derives the same id whatever the order of the argument keys', async () => {
      const { subscriptions } = await subscriptionsFor([]);
      const url = 'https://hooks.example.com/mcp';

      const one = subscriptions.identityOf('principal:ada', url, 'order.created', { status: 'paid', region: 'eu' });
      const other = subscriptions.identityOf('principal:ada', url, 'order.created', { region: 'eu', status: 'paid' });

      expect(one.id).toMatch(/^sub_[0-9a-f]{32}$/);
      expect(other).toEqual(one);
      expect(one.argumentsKey).toBe('{"region":"eu","status":"paid"}');
    });

    it.each([
      ['another owner', ['principal:bob', 'https://hooks.example.com/mcp', 'order.created', { status: 'paid' }]],
      ['another callback', ['principal:ada', 'https://hooks.example.com/other', 'order.created', { status: 'paid' }]],
      ['another event', ['principal:ada', 'https://hooks.example.com/mcp', 'order.shipped', { status: 'paid' }]],
      ['other arguments', ['principal:ada', 'https://hooks.example.com/mcp', 'order.created', { status: 'open' }]],
    ] as const)('derives another id for %s', async (_label, [principalKey, url, eventName, args]) => {
      const { subscriptions } = await subscriptionsFor([]);
      const reference = subscriptions.identityOf('principal:ada', 'https://hooks.example.com/mcp', 'order.created', {
        status: 'paid',
      });

      expect(subscriptions.identityOf(principalKey, url, eventName, args).id).not.toBe(reference.id);
    });
  });

  describe('grantExpiry', () => {
    const event = eventNamed('order.created');

    it('grants the default lifetime to a subscription that asks for none', async () => {
      const { subscriptions } = await subscriptionsFor([event]);

      expect(subscriptions.grantExpiry(event, undefined, NOW)).toBe(NOW + HOUR_MS);
    });

    it.each([
      ['a lifetime within the bounds as asked', 10 * MINUTE_MS, 10 * MINUTE_MS],
      ['a longer one clamped to the maximum', 48 * HOUR_MS, 24 * HOUR_MS],
      ['a shorter one raised to the minimum', 1000, MINUTE_MS],
      ['a negative one raised to the minimum', -5, MINUTE_MS],
    ])('grants %s', async (_label, requestedTtlMs, grantedMs) => {
      const { subscriptions } = await subscriptionsFor([event]);

      expect(subscriptions.grantExpiry(event, requestedTtlMs, NOW)).toBe(NOW + grantedMs);
    });

    it('grants the maximum instead of no expiry on a memory store', async () => {
      const allowing = eventsConfigSchema.parse({
        store: { sqlite: { path: 'unused.sqlite' } },
        subscriptions: { allowNoExpiry: true },
      }).subscriptions;
      const { subscriptions } = await subscriptionsFor([event], { durable: false, settings: allowing });

      expect(subscriptions.grantExpiry(event, null, NOW)).toBe(NOW + 24 * HOUR_MS);
    });

    it('grants the maximum instead of no expiry unless the server allows it', async () => {
      const { subscriptions } = await subscriptionsFor([event], { durable: true });

      expect(subscriptions.grantExpiry(event, null, NOW)).toBe(NOW + 24 * HOUR_MS);
    });

    it('grants no expiry on a durable store that allows it, except to an event with a maximum of its own', async () => {
      const allowing = { ...settings, allowNoExpiry: true };
      const { subscriptions } = await subscriptionsFor([event], { durable: true, settings: allowing });
      const bounded = eventNamed('order.shipped', {}, { maxMs: 2 * HOUR_MS });

      expect(subscriptions.grantExpiry(event, null, NOW)).toBeNull();
      expect(subscriptions.grantExpiry(bounded, null, NOW)).toBe(NOW + 2 * HOUR_MS);
    });

    it("keeps an event's own bounds within the server's", async () => {
      const { subscriptions } = await subscriptionsFor([]);
      const short = eventNamed('short', {}, { defaultMs: 5 * MINUTE_MS, maxMs: 10 * MINUTE_MS });
      const greedy = eventNamed('greedy', {}, { defaultMs: 72 * HOUR_MS, maxMs: 96 * HOUR_MS });
      const tiny = eventNamed('tiny', {}, { maxMs: 30_000 });

      expect(subscriptions.grantExpiry(short, undefined, NOW)).toBe(NOW + 5 * MINUTE_MS);
      expect(subscriptions.grantExpiry(short, HOUR_MS, NOW)).toBe(NOW + 10 * MINUTE_MS);
      expect(subscriptions.grantExpiry(greedy, undefined, NOW)).toBe(NOW + 24 * HOUR_MS);
      expect(subscriptions.grantExpiry(tiny, 1000, NOW)).toBe(NOW + 30_000);
    });

    it('exposes the limits it applies', async () => {
      const { subscriptions } = await subscriptionsFor([]);

      expect(subscriptions.settings).toEqual({
        defaultTtlMs: HOUR_MS,
        maxTtlMs: 24 * HOUR_MS,
        minTtlMs: MINUTE_MS,
        allowNoExpiry: false,
        maxPerPrincipal: 100,
        reauthorizeEveryMs: 300_000,
        suspendedTtlMs: 604_800_000,
      });
    });
  });

  describe('rotatedDelivery', () => {
    const url = 'https://hooks.example.com/mcp';

    it('gives a new subscription its secret alone', async () => {
      const { subscriptions } = await subscriptionsFor([]);

      expect(subscriptions.rotatedDelivery(undefined, url, 'whsec_current', NOW)).toEqual({
        mode: 'webhook',
        url,
        secret: 'whsec_current',
      });
    });

    it('keeps a replaced secret for the grace period', async () => {
      const { subscriptions } = await subscriptionsFor([]);
      const current = { mode: 'webhook' as const, url, secret: 'whsec_old' };

      expect(subscriptions.rotatedDelivery(current, url, 'whsec_new', NOW)).toEqual({
        mode: 'webhook',
        url,
        secret: 'whsec_new',
        previousSecret: 'whsec_old',
        previousSecretUntil: NOW + 5 * MINUTE_MS,
      });
    });

    it('keeps a running grace through a refresh with the same secret, and drops one that ended', async () => {
      const { subscriptions } = await subscriptionsFor([]);
      const rotating = {
        mode: 'webhook' as const,
        url,
        secret: 'whsec_new',
        previousSecret: 'whsec_old',
        previousSecretUntil: NOW + MINUTE_MS,
      };

      expect(subscriptions.rotatedDelivery(rotating, url, 'whsec_new', NOW)).toEqual(rotating);
      expect(subscriptions.rotatedDelivery(rotating, url, 'whsec_new', NOW + MINUTE_MS)).toEqual({
        mode: 'webhook',
        url,
        secret: 'whsec_new',
      });
      expect(
        subscriptions.rotatedDelivery({ ...rotating, previousSecretUntil: undefined }, url, 'whsec_new', NOW),
      ).toEqual({ mode: 'webhook', url, secret: 'whsec_new' });
    });
  });

  describe('lifecycle methods of the event', () => {
    it('calls onSubscribe with the arguments and the subscription', async () => {
      const onSubscribe = jest.fn();
      const event = eventNamed('order.created', { onSubscribe });
      const { subscriptions } = await subscriptionsFor([event]);
      const record = subscription();
      const authInfo = { sessionId: 'session-1' };

      await subscriptions.notifySubscribed(event, record, authInfo);

      expect(event.create).toHaveBeenCalledWith(authInfo);
      expect(onSubscribe).toHaveBeenCalledWith(record.arguments, {
        id: 'sub_0001',
        name: 'order.created',
        mode: 'webhook',
        subscriber: record.subscriber,
      });
    });

    it('lets a failing onSubscribe reach the caller', async () => {
      const event = eventNamed('order.created', { onSubscribe: jest.fn().mockRejectedValue(new Error('upstream')) });
      const { subscriptions } = await subscriptionsFor([event]);

      await expect(subscriptions.notifySubscribed(event, subscription(), {})).rejects.toThrow('upstream');
    });

    it('calls onUnsubscribe with the reason', async () => {
      const onUnsubscribe = jest.fn();
      const event = eventNamed('order.created', { onUnsubscribe });
      const { subscriptions } = await subscriptionsFor([event]);
      const record = subscription();

      await subscriptions.notifyUnsubscribed(record, 'unsubscribed', { sessionId: 'session-1' });

      expect(onUnsubscribe).toHaveBeenCalledWith(record.arguments, subscriptionRefOf(record), 'unsubscribed');
    });

    it('logs a failing onUnsubscribe instead of throwing', async () => {
      const failure = new Error('upstream');
      const event = eventNamed('order.created', { onUnsubscribe: jest.fn().mockRejectedValue(failure) });
      const { subscriptions, warn } = await subscriptionsFor([event]);

      await expect(subscriptions.notifyUnsubscribed(subscription(), 'expired')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'onUnsubscribe of event "order.created" failed for subscription sub_0001',
        failure,
      );
    });

    it('skips an event that has no such method, or that is no longer registered', async () => {
      const event = eventNamed('order.created');
      const { subscriptions } = await subscriptionsFor([event]);

      await expect(subscriptions.notifySubscribed(event, subscription(), {})).resolves.toBeUndefined();
      await expect(subscriptions.notifyUnsubscribed(subscription(), 'expired')).resolves.toBeUndefined();
      await expect(
        subscriptions.notifyUnsubscribed(subscription({ eventName: 'removed.event' }), 'expired'),
      ).resolves.toBeUndefined();
    });
  });

  describe('expiry', () => {
    it('ends an expired subscription once and tells its event', async () => {
      const onUnsubscribe = jest.fn();
      const { subscriptions, store } = await subscriptionsFor([eventNamed('order.created', { onUnsubscribe })]);
      await store.upsert(subscription({ expiresAt: NOW - 1 }));

      await subscriptions.expire('sub_0001');
      await subscriptions.expire('sub_0001');

      expect(onUnsubscribe).toHaveBeenCalledTimes(1);
      expect(onUnsubscribe).toHaveBeenCalledWith(
        { status: 'paid' },
        expect.objectContaining({ id: 'sub_0001' }),
        'expired',
      );
    });

    it('leaves a live subscription alone', async () => {
      const onUnsubscribe = jest.fn();
      const { subscriptions, store } = await subscriptionsFor([eventNamed('order.created', { onUnsubscribe })]);
      await store.upsert(subscription());

      await subscriptions.expire('sub_0001');

      expect(onUnsubscribe).not.toHaveBeenCalled();
      await expect(store.get('sub_0001')).resolves.toBeDefined();
    });

    it('sweeps every expired subscription', async () => {
      const onUnsubscribe = jest.fn();
      const { subscriptions, store } = await subscriptionsFor([eventNamed('order.created', { onUnsubscribe })]);
      await store.upsert(subscription({ id: 'sub_old_1', expiresAt: NOW - 2 }));
      await store.upsert(subscription({ id: 'sub_old_2', expiresAt: NOW - 1 }));
      await store.upsert(subscription({ id: 'sub_live' }));

      await subscriptions.sweep();

      expect(onUnsubscribe.mock.calls.map(([, ref]) => ref.id).sort()).toEqual(['sub_old_1', 'sub_old_2']);
      await expect(store.listExpired(NOW)).resolves.toEqual([]);
    });

    it('sweeps on access at most once per interval', async () => {
      const { subscriptions, store } = await subscriptionsFor([]);
      const listExpired = jest.spyOn(store, 'listExpired');

      subscriptions.sweepIfDue();
      subscriptions.sweepIfDue();
      expect(listExpired).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(SUBSCRIPTION_SWEEP_INTERVAL_MS);
      subscriptions.sweepIfDue();
      expect(listExpired).toHaveBeenCalledTimes(2);
    });

    it('logs a sweep that fails', async () => {
      const { subscriptions, store, warn } = await subscriptionsFor([]);
      const failure = new Error('store down');
      jest.spyOn(store, 'listExpired').mockRejectedValue(failure);

      subscriptions.sweepIfDue();
      await jest.advanceTimersByTimeAsync(0);

      expect(warn).toHaveBeenCalledWith('The subscription expiry sweep failed', failure);
    });

    it('sweeps on a timer in a long-lived process, until it is closed', async () => {
      const { subscriptions, store } = await subscriptionsFor([]);
      const listExpired = jest.spyOn(store, 'listExpired');
      const close = jest.spyOn(store, 'close');

      subscriptions.start();
      await jest.advanceTimersByTimeAsync(2 * SUBSCRIPTION_SWEEP_INTERVAL_MS);
      expect(listExpired).toHaveBeenCalledTimes(2);

      await subscriptions.close();
      await jest.advanceTimersByTimeAsync(2 * SUBSCRIPTION_SWEEP_INTERVAL_MS);
      expect(listExpired).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a serverless deployment', { runtime: 'node', deployment: 'serverless' }],
      ['an edge runtime', { runtime: 'edge', deployment: 'standalone' }],
      ['a browser', { runtime: 'browser', deployment: 'standalone' }],
    ])('starts no timer in %s', async (_label, runtimeContext) => {
      jest.mocked(getRuntimeContext).mockReturnValue(runtimeContext as never);
      const { subscriptions, store } = await subscriptionsFor([]);
      const listExpired = jest.spyOn(store, 'listExpired');

      subscriptions.start();
      await jest.advanceTimersByTimeAsync(3 * SUBSCRIPTION_SWEEP_INTERVAL_MS);

      expect(listExpired).not.toHaveBeenCalled();
      await subscriptions.close();
    });
  });

  describe('deliveryStatusOf', () => {
    it('reports a subscription that never delivered', () => {
      expect(deliveryStatusOf(subscription())).toEqual({
        active: true,
        lastDeliveryAt: null,
        lastError: null,
        failedSince: null,
      });
    });

    it('reports the last delivery and the failure a suspended subscription is in', () => {
      const record = subscription({
        active: false,
        status: { lastDeliveryAt: NOW - HOUR_MS, lastError: 'http_5xx', failedSince: NOW - MINUTE_MS },
      });

      expect(deliveryStatusOf(record)).toEqual({
        active: false,
        lastDeliveryAt: new Date(NOW - HOUR_MS).toISOString(),
        lastError: 'http_5xx',
        failedSince: new Date(NOW - MINUTE_MS).toISOString(),
      });
    });
  });
});
