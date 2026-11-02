import { createMemoryStorage } from '@frontmcp/utils';

import { createResultHandleStore } from '../result-handle-store.factory';
import { addFoldingStore, foldingStoresOf, ResultHandleStore, type ResultOwner } from '../result-handle.store';

const alice = { session: 'session-1', caller: 'alice' };
const answer = { rows: [1, 2, 3] };

describe('ResultHandleStore', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  async function memoryStore(ttlSeconds = 60) {
    return createResultHandleStore({ storage: { type: 'memory' }, namespace: 'result-handles', ttlSeconds });
  }

  async function saved(store: ResultHandleStore, owner: ResultOwner): Promise<string> {
    const handle = store.newHandle();
    await store.save(handle, answer, owner);
    return handle;
  }

  it('saves an answer under a random handle that only its owner reads back', async () => {
    const store = await memoryStore();
    const handle = await saved(store, alice);

    expect(handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store.newHandle()).not.toBe(handle);
    expect(await store.read(handle, alice)).toEqual({ value: answer });
  });

  it.each([
    ['another session', { session: 'session-2', caller: 'alice' }],
    ['another caller', { session: 'session-1', caller: 'mallory' }],
    ['an anonymous caller', { session: 'session-1' }],
    ['no session', { caller: 'alice' }],
  ])('reads nothing for %s', async (_, owner) => {
    const store = await memoryStore();
    const handle = await saved(store, alice);
    expect(await store.read(handle, owner)).toBeUndefined();
  });

  it('binds an answer to the caller alone when the call had no session', async () => {
    const store = await memoryStore();
    const handle = await saved(store, { caller: 'alice' });
    expect(await store.read(handle, { caller: 'alice' })).toEqual({ value: answer });
    expect(await store.read(handle, { caller: 'bob' })).toBeUndefined();
  });

  it('reads nothing for an unknown or malformed handle', async () => {
    const store = await memoryStore();
    expect(await store.read('3f1c2a4e-9b7d-4c1e-8f2a-1b2c3d4e5f60', alice)).toBeUndefined();
    expect(await store.read('*', alice)).toBeUndefined();
  });

  it('forgets an answer after its TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z') });
    const store = await memoryStore(2);
    const handle = await saved(store, alice);

    jest.advanceTimersByTime(1000);
    expect(await store.read(handle, alice)).toEqual({ value: answer });
    jest.advanceTimersByTime(1500);
    expect(await store.read(handle, alice)).toBeUndefined();
  });

  async function rootStore() {
    const root = createMemoryStorage();
    await root.connect();
    return { root, store: new ResultHandleStore(root.namespace('result-handles'), 60) };
  }

  it('keeps an answer encrypted, under a key that is not its handle', async () => {
    const { root, store } = await rootStore();
    const handle = await saved(store, alice);

    const keys = await root.keys('*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(handle);
    const stored = (await root.get(keys[0])) ?? '';
    expect(stored).not.toContain('rows');
    expect(stored).not.toContain('alice');
    expect(stored).not.toContain('session-1');
  });

  it("keeps each owner's answer under its own key, so another owner looks up a key that holds nothing", async () => {
    const { root, store } = await rootStore();
    const get = jest.spyOn(root.root, 'get');
    const handle = await saved(store, alice);

    await store.read(handle, alice);
    await store.read(handle, { session: 'session-2', caller: 'alice' });
    const [ownKey, otherKey] = get.mock.calls.map(([key]) => key);
    expect(otherKey).not.toBe(ownKey);
    expect(await get.mock.results[1].value).toBeNull();
  });

  it('reads nothing from a record it cannot decrypt', async () => {
    const { root, store } = await rootStore();
    const handle = await saved(store, alice);
    const [key] = await root.keys('*');
    const blob = JSON.parse((await root.get(key)) ?? '{}') as Record<string, string>;

    await root.set(key, JSON.stringify({ ...blob, tag: 'A'.repeat(22) }));
    expect(await store.read(handle, alice)).toBeUndefined();
    await root.set(key, 'not json');
    expect(await store.read(handle, alice)).toBeUndefined();
  });

  it('lists, once each, the stores that folded an answer in a scope', async () => {
    const scope = {};
    const store = await memoryStore();

    expect([...foldingStoresOf(scope)]).toEqual([]);
    addFoldingStore(scope, store);
    addFoldingStore(scope, store);
    expect([...foldingStoresOf(scope)]).toEqual([store]);
    expect([...foldingStoresOf({})]).toEqual([]);
  });

  it('disconnects its storage at shutdown', async () => {
    const storage = createMemoryStorage();
    const disconnect = jest.spyOn(storage.root, 'disconnect');
    const store = new ResultHandleStore(storage.namespace('result-handles'), 60);

    await store.onShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
