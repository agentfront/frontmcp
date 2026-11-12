import { durableObjectSqlite, useSqliteDriver } from '@frontmcp/storage-sqlite';

import {
  fakeDurableObjectStorage,
  type FakeDurableObjectStorage,
} from '../../../../storage-sqlite/src/__test-utils__/fake-durable-object-storage';
import { createEventSubscriptionStore } from '../subscription/event-subscription-store.factory';
import type { EventSubscriptionRecord, EventSubscriptionStore } from '../subscription/event-subscription.store';

const HOUR_MS = 3_600_000;
const OWNER = 'principal:https://auth.example.com#ada';

function subscription(overrides: Partial<EventSubscriptionRecord> = {}): EventSubscriptionRecord {
  const now = Date.now();
  return {
    id: 'sub_0001',
    principalKey: OWNER,
    subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} },
    eventName: 'clock.tick',
    arguments: {},
    argumentsKey: '{}',
    delivery: { mode: 'webhook', url: 'https://hooks.example.com/mcp', secret: 'whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQ' },
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
}

describe("the Events subscription store on a Durable Object's SQLite", () => {
  let storage: FakeDurableObjectStorage;
  let store: EventSubscriptionStore;

  beforeEach(async () => {
    storage = fakeDurableObjectStorage();
    useSqliteDriver(durableObjectSqlite(storage));
    const opened = await createEventSubscriptionStore({
      sqlite: { path: 'events.sqlite', ttlCleanupIntervalMs: 0 },
      secret: 'a-secret-for-specs',
    });
    store = opened.store;
  });

  afterEach(async () => {
    await store.close();
    useSqliteDriver(undefined);
  });

  it('stores, lists, counts, updates and removes subscriptions', async () => {
    await store.upsert(subscription({ id: 'sub_0001' }));
    await store.upsert(subscription({ id: 'sub_0002' }));
    await store.upsert(subscription({ id: 'sub_0003', eventName: 'order.created', principalKey: 'principal:grace' }));

    await expect(store.get('sub_0001')).resolves.toMatchObject({ id: 'sub_0001', eventName: 'clock.tick' });
    expect((await store.listByEvent('clock.tick')).map((record) => record.id).sort()).toEqual(['sub_0001', 'sub_0002']);
    await expect(store.countByPrincipal(OWNER)).resolves.toBe(2);

    await expect(store.update('sub_0001', { active: false })).resolves.toMatchObject({ active: false });
    await expect(store.delete('sub_0002')).resolves.toMatchObject({ id: 'sub_0002' });
    await expect(store.delete('sub_0002')).resolves.toBeUndefined();
    await expect(store.countByPrincipal(OWNER)).resolves.toBe(1);
  });

  it('lists a subscription as expired once its lifetime is over, and removes it once', async () => {
    const now = Date.now();
    await store.upsert(subscription({ id: 'sub_old', expiresAt: now - 1000 }));
    await store.upsert(subscription({ id: 'sub_live' }));

    await expect(store.get('sub_old')).resolves.toBeUndefined();
    expect((await store.listExpired(now)).map((record) => record.id)).toEqual(['sub_old']);
    await expect(store.deleteExpired('sub_old', now)).resolves.toMatchObject({ id: 'sub_old' });
    await expect(store.deleteExpired('sub_old', now)).resolves.toBeUndefined();
    await expect(store.listExpired(now)).resolves.toEqual([]);
  });

  it('keeps the subscriptions for the next instance of the Durable Object', async () => {
    await store.upsert(subscription());

    useSqliteDriver(durableObjectSqlite(storage.nextInstance()));
    const reopened = await createEventSubscriptionStore({
      sqlite: { path: 'events.sqlite', ttlCleanupIntervalMs: 0 },
      secret: 'a-secret-for-specs',
    });

    await expect(reopened.store.get('sub_0001')).resolves.toMatchObject({ id: 'sub_0001' });
    await expect(reopened.store.countByPrincipal(OWNER)).resolves.toBe(1);
    await reopened.store.close();
  });
});
