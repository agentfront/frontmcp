import { createMemoryStorage } from '@frontmcp/utils';

import { createResultHandleStore } from '../result-handle-store.factory';
import { ResultHandleStore, type ResultOwner } from '../result-handle.store';

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

  it('reads nothing from a key that does not hold a stored answer', async () => {
    const root = createMemoryStorage();
    await root.connect();
    const storage = root.namespace('result-handles');
    const store = new ResultHandleStore(storage, 60);
    const handle = '3f1c2a4e-9b7d-4c1e-8f2a-1b2c3d4e5f60';

    await storage.set(handle, 'not json');
    expect(await store.read(handle, alice)).toBeUndefined();
    await storage.set(handle, JSON.stringify({ owner: 'alice', value: 1 }));
    expect(await store.read(handle, alice)).toBeUndefined();
  });

  it('disconnects its storage at shutdown', async () => {
    const storage = createMemoryStorage();
    const disconnect = jest.spyOn(storage.root, 'disconnect');
    const store = new ResultHandleStore(storage.namespace('result-handles'), 60);

    await store.onShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
