import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import {
  EventPublishIdempotency,
  PUBLISH_CLAIM_SECONDS,
  PUBLISH_IDEMPOTENCY_WINDOW_SECONDS,
} from '../publish-endpoint/event-publish-idempotency';

describe('EventPublishIdempotency', () => {
  let storage: NamespacedStorage;
  let idempotency: EventPublishIdempotency;

  beforeEach(async () => {
    storage = createMemoryStorage({ prefix: 'spec:events:' });
    await storage.connect();
    idempotency = new EventPublishIdempotency(storage);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await storage.disconnect();
  });

  it('gives an eventId to the first request that claims it', async () => {
    expect(await idempotency.claim('order.created', 'evt-1')).toEqual({ state: 'claimed' });
  });

  it('tells a second request that the first is still publishing', async () => {
    await idempotency.claim('order.created', 'evt-1');

    expect(await idempotency.claim('order.created', 'evt-1')).toEqual({ state: 'in-flight' });
  });

  it('answers a later request with what the first publish got', async () => {
    await idempotency.claim('order.created', 'evt-1');
    await idempotency.complete('order.created', 'evt-1', { eventId: 'evt-1', matched: 3 });

    expect(await idempotency.claim('order.created', 'evt-1')).toEqual({
      state: 'published',
      result: { eventId: 'evt-1', matched: 3 },
    });
  });

  it('gives the eventId out again once a failed publish released it', async () => {
    await idempotency.claim('order.created', 'evt-1');
    await idempotency.release('order.created', 'evt-1');

    expect(await idempotency.claim('order.created', 'evt-1')).toEqual({ state: 'claimed' });
  });

  it('keeps the same eventId of two events apart', async () => {
    await idempotency.claim('order.created', 'evt-1');

    expect(await idempotency.claim('order.shipped', 'evt-1')).toEqual({ state: 'claimed' });
  });

  it('is shared by every process on the same storage', async () => {
    const otherProcess = new EventPublishIdempotency(storage);
    await idempotency.claim('order.created', 'evt-1');
    await idempotency.complete('order.created', 'evt-1', { eventId: 'evt-1', matched: 1 });

    expect(await otherProcess.claim('order.created', 'evt-1')).toMatchObject({ state: 'published' });
  });

  it('holds a claim for a minute and an answer for ten', async () => {
    const set = jest.spyOn(storage, 'set');

    await idempotency.claim('order.created', 'evt-1');
    await idempotency.complete('order.created', 'evt-1', { eventId: 'evt-1', matched: 0 });

    expect(PUBLISH_CLAIM_SECONDS).toBe(60);
    expect(PUBLISH_IDEMPOTENCY_WINDOW_SECONDS).toBe(600);
    expect(set.mock.calls[0][2]).toEqual({ ttlSeconds: 60, ifNotExists: true });
    expect(set.mock.calls[1][2]).toEqual({ ttlSeconds: 600 });
  });

  it('stores under a hashed key, whatever the id holds', async () => {
    const set = jest.spyOn(storage, 'set');

    await idempotency.claim('order.created', 'evt:*?[1]');

    expect(set.mock.calls[0][0]).toMatch(/^published:[0-9a-f]{40}$/);
  });

  it('treats a claim that lapsed while it was read as still publishing', async () => {
    jest.spyOn(storage, 'get').mockResolvedValueOnce(null);

    expect(await idempotency.claim('order.created', 'evt-1')).toEqual({ state: 'in-flight' });
  });
});
