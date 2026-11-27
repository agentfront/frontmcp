import { createMemoryStorage } from '@frontmcp/utils';

import { createResultHandleStore } from '../result-handle-store.factory';
import { addFoldingStore, foldingStoresOf, ResultHandleStore, type ResultOwner } from '../result-handle.store';

const alice = { session: 'session-1', caller: 'alice' };
const answer = { rows: [1, 2, 3] };

describe('ResultHandleStore', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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

  describe('with slidingTtl', () => {
    it('starts the TTL again on each read, and forgets an answer nobody read for a TTL', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z') });
      const root = createMemoryStorage({ enableSweeper: false });
      await root.connect();
      const store = new ResultHandleStore(root.namespace('result-handles'), 2, { slidingTtl: true });
      const handle = await saved(store, alice);

      jest.advanceTimersByTime(1500);
      expect(await store.read(handle, alice)).toEqual({ value: answer });
      jest.advanceTimersByTime(1500);
      expect(await store.read(handle, alice)).toEqual({ value: answer });
      jest.advanceTimersByTime(2500);
      expect(await store.read(handle, alice)).toBeUndefined();
    });

    it("does not renew the TTL of another owner's lookup", async () => {
      jest.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z') });
      const root = createMemoryStorage({ enableSweeper: false });
      await root.connect();
      const store = new ResultHandleStore(root.namespace('result-handles'), 2, { slidingTtl: true });
      const handle = await saved(store, alice);

      jest.advanceTimersByTime(1500);
      expect(await store.read(handle, { session: 'session-2', caller: 'alice' })).toBeUndefined();
      jest.advanceTimersByTime(1000);
      expect(await store.read(handle, alice)).toBeUndefined();
    });
  });

  describe('with maxStoredBytes', () => {
    const big = (tag: string) => ({ tag, rows: 'x'.repeat(4000) });

    async function storedBytesOf(value: unknown): Promise<number> {
      const { root, store } = await rootStore();
      await store.save(store.newHandle(), value, alice);
      const [key] = await root.keys('*');
      return ((await root.get(key)) ?? '').length;
    }

    async function budgetStore(answers: number, ttlSeconds = 60) {
      const bytes = await storedBytesOf(big('a'));
      const root = createMemoryStorage({ enableSweeper: false });
      await root.connect();
      const storage = root.namespace('result-handles');
      const store = new ResultHandleStore(storage, ttlSeconds, {
        maxStoredBytes: Math.floor(bytes * (answers + 0.5)),
      });
      return { root, storage, store };
    }

    async function keep(store: ResultHandleStore, tag: string): Promise<string> {
      const handle = store.newHandle();
      await store.save(handle, big(tag), alice);
      return handle;
    }

    it('drops the least recently saved or read answers past the budget', async () => {
      const { root, store } = await budgetStore(2);
      const first = await keep(store, 'first');
      const second = await keep(store, 'second');
      expect(await store.read(first, alice)).toBeDefined();

      const third = await keep(store, 'third');
      expect(await root.keys('*')).toHaveLength(2);
      expect(await store.read(second, alice)).toBeUndefined();
      expect(await store.read(first, alice)).toEqual({ value: big('first') });
      expect(await store.read(third, alice)).toEqual({ value: big('third') });
    });

    it('keeps the budget when two saves run at once, the first one still writing', async () => {
      const { root, storage, store } = await budgetStore(1);
      const write = storage.set.bind(storage);
      let release: () => void = () => undefined;
      jest.spyOn(storage, 'set').mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => (release = resolve));
        return write(...args);
      });

      const first = store.save(store.newHandle(), big('first'), alice);
      const second = store.newHandle();
      const saving = store.save(second, big('second'), alice);
      await new Promise((resolve) => setImmediate(resolve));
      release();
      await Promise.all([first, saving]);

      expect(await root.keys('*')).toHaveLength(1);
      expect(await store.read(second, alice)).toEqual({ value: big('second') });
    });

    it('keeps counting the answers it could not drop, and counts none it did not keep', async () => {
      const { root, storage, store } = await budgetStore(1);
      const kept = await keep(store, 'kept');
      jest.spyOn(storage, 'mdelete').mockRejectedValueOnce(new Error('storage down'));

      await expect(keep(store, 'refused')).rejects.toThrow('storage down');
      expect(await root.keys('*')).toHaveLength(1);
      const next = await keep(store, 'next');

      expect(await root.keys('*')).toHaveLength(1);
      expect(await store.read(kept, alice)).toBeUndefined();
      expect(await store.read(next, alice)).toEqual({ value: big('next') });
    });

    it('refuses an answer larger than the whole budget, keeping the others', async () => {
      const { root, store } = await budgetStore(1);
      const kept = await keep(store, 'kept');

      await expect(store.save(store.newHandle(), { rows: 'x'.repeat(20_000) }, alice)).rejects.toThrow(
        /^it takes \d+ bytes stored, over maxStoredBytes \(\d+\)$/,
      );
      expect(await root.keys('*')).toHaveLength(1);
      expect(await store.read(kept, alice)).toEqual({ value: big('kept') });
    });

    it('does not count answers whose TTL ran out, though read since', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z') });
      const { store } = await budgetStore(2, 2);
      const expiring = await keep(store, 'expiring');
      jest.advanceTimersByTime(1000);
      const live = await keep(store, 'live');
      expect(await store.read(expiring, alice)).toBeDefined();
      jest.advanceTimersByTime(1500);

      const fresh = await keep(store, 'fresh');
      expect(await store.read(live, alice)).toEqual({ value: big('live') });
      expect(await store.read(fresh, alice)).toEqual({ value: big('fresh') });
    });

    it('does not count an answer the storage failed to keep, or one that left it', async () => {
      const { root, store } = await budgetStore(2);
      jest.spyOn(root.root, 'set').mockRejectedValueOnce(new Error('connection refused'));
      await expect(keep(store, 'failed')).rejects.toThrow('connection refused');
      const gone = await keep(store, 'gone');
      const [key] = await root.keys('*');
      await root.delete(key);
      expect(await store.read(gone, alice)).toBeUndefined();

      const kept = [await keep(store, 'kept-1'), await keep(store, 'kept-2')];
      for (const handle of kept) expect(await store.read(handle, alice)).toBeDefined();
    });
  });

  it('disconnects its storage at shutdown', async () => {
    const storage = createMemoryStorage();
    const disconnect = jest.spyOn(storage.root, 'disconnect');
    const store = new ResultHandleStore(storage.namespace('result-handles'), 60);

    await store.onShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
