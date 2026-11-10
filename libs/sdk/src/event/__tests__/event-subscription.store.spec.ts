import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import { EventSubscriptionStoreError } from '../../errors';
import { StorageEventSubscriptionStore, type EventSubscriptionRecord } from '../subscription/event-subscription.store';

const STORE_SECRET = 'store-secret-for-specs';
const HOUR_MS = 3_600_000;

async function connectedStorage(): Promise<NamespacedStorage> {
  const storage = createMemoryStorage({ prefix: 'spec:events:' });
  await storage.connect();
  return storage;
}

function subscription(overrides: Partial<EventSubscriptionRecord> = {}): EventSubscriptionRecord {
  const now = Date.now();
  return {
    id: 'sub_0001',
    principalKey: 'principal:https://auth.example.com#ada',
    subscriber: { sub: 'ada', roles: ['admin'], permissions: [], scopes: [], claims: {} },
    eventName: 'order.created',
    arguments: { status: 'paid' },
    argumentsKey: '{"status":"paid"}',
    delivery: {
      mode: 'webhook',
      url: 'https://hooks.example.com/mcp',
      secret: 'whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0',
    },
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

describe.each([
  ['plain', undefined],
  ['encrypted', STORE_SECRET],
])('StorageEventSubscriptionStore (%s)', (_label, secret) => {
  let storage: NamespacedStorage;
  let store: StorageEventSubscriptionStore;

  beforeEach(async () => {
    storage = await connectedStorage();
    store = new StorageEventSubscriptionStore({ storage, secret });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await store.close();
  });

  it('returns what it stored, by id', async () => {
    const record = subscription();
    await store.upsert(record);

    await expect(store.get(record.id)).resolves.toEqual(record);
    await expect(store.get('sub_missing')).resolves.toBeUndefined();
  });

  it('replaces the subscription stored under the same id', async () => {
    await store.upsert(subscription());
    await store.upsert(subscription({ active: false }));

    await expect(store.get('sub_0001')).resolves.toMatchObject({ active: false });
    await expect(store.listByEvent('order.created')).resolves.toHaveLength(1);
  });

  it('lists the subscriptions of one event only', async () => {
    await store.upsert(subscription({ id: 'sub_0001' }));
    await store.upsert(subscription({ id: 'sub_0002' }));
    await store.upsert(subscription({ id: 'sub_0003', eventName: 'order.shipped' }));

    const listed = await store.listByEvent('order.created');

    expect(listed.map((record) => record.id).sort()).toEqual(['sub_0001', 'sub_0002']);
    await expect(store.listByEvent('order.refunded')).resolves.toEqual([]);
  });

  it('counts the subscriptions of one owner only', async () => {
    await store.upsert(subscription({ id: 'sub_0001' }));
    await store.upsert(subscription({ id: 'sub_0002' }));
    await store.upsert(subscription({ id: 'sub_0003', principalKey: 'principal:bob' }));

    await expect(store.countByPrincipal('principal:https://auth.example.com#ada')).resolves.toBe(2);
    await expect(store.countByPrincipal('principal:bob')).resolves.toBe(1);
    await expect(store.countByPrincipal('principal:eve')).resolves.toBe(0);
  });

  it('removes a subscription once, with its index entries', async () => {
    const record = subscription();
    await store.upsert(record);

    await expect(store.delete(record.id)).resolves.toEqual(record);
    await expect(store.delete(record.id)).resolves.toBeUndefined();
    await expect(store.get(record.id)).resolves.toBeUndefined();
    await expect(store.listByEvent(record.eventName)).resolves.toEqual([]);
    await expect(store.countByPrincipal(record.principalKey)).resolves.toBe(0);
  });

  it('updates a subscription from a patch and from a function of the stored one', async () => {
    await store.upsert(subscription());

    await store.update('sub_0001', { active: false });
    const updated = await store.update('sub_0001', (current) => ({
      status: { ...current.status, lastError: 'timeout', failedSince: 1000 },
    }));

    expect(updated).toMatchObject({ active: false, status: { lastError: 'timeout', failedSince: 1000 } });
    await expect(store.get('sub_0001')).resolves.toEqual(updated);
  });

  it('updates nothing for a subscription that is gone', async () => {
    await expect(store.update('sub_missing', { active: false })).resolves.toBeUndefined();
  });

  it('keeps a subscription without expiry out of the expired ones', async () => {
    await store.upsert(subscription({ expiresAt: null }));
    await store.update('sub_0001', { active: false });

    await expect(store.listExpired(Date.now() + 10 * HOUR_MS)).resolves.toEqual([]);
    await expect(store.get('sub_0001')).resolves.toMatchObject({ expiresAt: null, active: false });
  });

  describe('once the lifetime is over', () => {
    const expiredAt = Date.now() - 1000;

    beforeEach(async () => {
      await store.upsert(subscription({ id: 'sub_old', expiresAt: expiredAt }));
      await store.upsert(subscription({ id: 'sub_live' }));
    });

    it('leaves the subscription out of every read', async () => {
      await expect(store.get('sub_old')).resolves.toBeUndefined();
      await expect(store.update('sub_old', { active: false })).resolves.toBeUndefined();
      expect((await store.listByEvent('order.created')).map((record) => record.id)).toEqual(['sub_live']);
      await expect(store.countByPrincipal('principal:https://auth.example.com#ada')).resolves.toBe(1);
    });

    it('lists it as expired until it is removed', async () => {
      const expired = await store.listExpired(Date.now());

      expect(expired.map((record) => record.id)).toEqual(['sub_old']);
      await expect(store.listExpired(expiredAt - 1)).resolves.toEqual([]);
    });

    it('removes it as expired once, and never a live one', async () => {
      const now = Date.now();

      await expect(store.deleteExpired('sub_live', now)).resolves.toBeUndefined();
      await expect(store.deleteExpired('sub_old', now)).resolves.toMatchObject({ id: 'sub_old' });
      await expect(store.deleteExpired('sub_old', now)).resolves.toBeUndefined();
      await expect(store.listExpired(now)).resolves.toEqual([]);
    });

    it('forgets the expiry of a subscription that was refreshed', async () => {
      await store.upsert(subscription({ id: 'sub_old', expiresAt: Date.now() + HOUR_MS }));

      await expect(store.listExpired(Date.now())).resolves.toEqual([]);
      await expect(store.get('sub_old')).resolves.toMatchObject({ id: 'sub_old' });
    });
  });

  describe('against writers that keep changing a record', () => {
    it('applies an update on top of the change another writer made first', async () => {
      await store.upsert(subscription());
      const setIfEquals = storage.setIfEquals.bind(storage);
      const racedOnce = jest.spyOn(storage, 'setIfEquals').mockImplementationOnce(async (key, expected, value) => {
        await store.upsert(subscription({ verifiedAt: 42 }));
        return setIfEquals(key, expected, value);
      });

      const updated = await store.update('sub_0001', { active: false });

      expect(racedOnce).toHaveBeenCalledTimes(2);
      expect(updated).toMatchObject({ active: false, verifiedAt: 42 });
    });

    it('gives up on an update that never wins', async () => {
      await store.upsert(subscription());
      jest.spyOn(storage, 'setIfEquals').mockResolvedValue(false);

      await expect(store.update('sub_0001', { active: false })).rejects.toThrow(EventSubscriptionStoreError);
    });

    it('gives up on a removal that never wins', async () => {
      await store.upsert(subscription());
      jest.spyOn(storage, 'deleteIfEquals').mockResolvedValue(false);

      await expect(store.delete('sub_0001')).rejects.toThrow('kept changing while it was removed');
    });
  });

  it('ignores a stored value it cannot read, or one stored under another id', async () => {
    await store.upsert(subscription({ id: 'sub_0001' }));
    const stored = await storage.get('s:sub_0001');
    await storage.set('s:sub_0002', stored as string);
    await storage.set('s:sub_0003', 'not a record');

    await expect(store.get('sub_0002')).resolves.toBeUndefined();
    await expect(store.get('sub_0003')).resolves.toBeUndefined();
  });
});

describe('StorageEventSubscriptionStore at rest', () => {
  it('stores no secret, callback or owner in the clear when it has a secret', async () => {
    const storage = await connectedStorage();
    const store = new StorageEventSubscriptionStore({ storage, secret: STORE_SECRET });
    const record = subscription();
    await store.upsert(record);

    const keys = await storage.keys('*');
    const values = await storage.mget(keys);
    const everything = [...keys, ...values].join('\n');

    expect(everything).not.toContain(record.delivery.secret);
    expect(everything).not.toContain('hooks.example.com');
    expect(everything).not.toContain('ada');
    expect(everything).not.toContain('order.created');
    await store.close();
  });

  it('cannot read a record with another secret', async () => {
    const storage = await connectedStorage();
    await new StorageEventSubscriptionStore({ storage, secret: STORE_SECRET }).upsert(subscription());

    const other = new StorageEventSubscriptionStore({ storage, secret: 'another-secret' });

    await expect(other.get('sub_0001')).resolves.toBeUndefined();
    await other.close();
  });
});
