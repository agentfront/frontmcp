import * as os from 'node:os';

import { createStorage, mkdtemp, pathJoin, rm } from '@frontmcp/utils';

import { isResourceKey } from '../../../common/metadata/materialized.metadata';
import { InvalidResourceStoreError } from '../../../errors';
import { resourceStore, type ResourceStore } from '../resource-store';

interface Board {
  open: number;
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('resourceStore()', () => {
  const stores: ResourceStore[] = [];
  const open = (options?: Parameters<typeof resourceStore>[0]): ResourceStore => {
    const store = resourceStore({ coalesceMs: 0, ...options });
    stores.push(store);
    return store;
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) await store.close();
  });

  describe('options', () => {
    it.each([
      [{ pollIntervalMs: 0 }, 'pollIntervalMs'],
      [{ coalesceMs: -1 }, 'coalesceMs'],
      [{ storage: 'sqlite' }, 'storage'],
      [{ storage: { type: 'postgres' } }, 'storage.type'],
      [{ storage: { type: 'upstash' } }, 'storage.type'],
      [{ storage: { type: 'auto' } }, 'storage.type'],
      [{ storage: {} }, 'storage.type'],
      [{ unknown: true }, 'unknown'],
    ])('refuses %j where it is declared', (options, path) => {
      expect(() => resourceStore(options as never)).toThrow(InvalidResourceStoreError);
      expect(() => resourceStore(options as never)).toThrow(path);
    });

    it('refuses a key without a name', () => {
      expect(() => open().key('')).toThrow(InvalidResourceStoreError);
    });

    it('stays open until each connect() has had its close()', async () => {
      const store = open();
      const board = store.key<Board>('board', { initial: { open: 0 } });
      await store.connect();
      await store.connect();
      await board.set({ open: 1 });

      await store.close();
      await expect(board.get()).resolves.toMatchObject({ value: { open: 1 }, revision: 1 });
      await store.close();
      await expect(board.get()).resolves.toMatchObject({ value: { open: 0 }, revision: 0 });
    });

    it('fails to connect when the storage cannot be opened, instead of falling back to memory', async () => {
      const store = open({ storage: { type: 'sqlite', sqlite: { path: '' } } });

      await expect(store.connect()).rejects.toThrow('sqlite.path');
    });
  });

  describe('a key', () => {
    it('reads its initial value at revision 0 until the first write', async () => {
      const board = open().key<Board>('board', { initial: { open: 0 } });

      await expect(board.get()).resolves.toEqual({ value: { open: 0 }, revision: 0 });
    });

    it('reads undefined at revision 0 without an initial value', async () => {
      await expect(open().key<Board>('board').get()).resolves.toEqual({ value: undefined, revision: 0 });
    });

    it('bumps the revision and the time on every write', async () => {
      const board = open().key<Board>('board', { initial: { open: 0 } });

      const first = await board.set({ open: 3 });
      const second = await board.update((current) => ({ open: current.open + 1 }));

      expect(first).toEqual({ value: { open: 3 }, revision: 1, updatedAt: expect.any(String) });
      expect(second).toEqual({ value: { open: 4 }, revision: 2, updatedAt: expect.any(String) });
      expect(Number.isNaN(Date.parse(second.updatedAt ?? ''))).toBe(false);
      await expect(board.get()).resolves.toEqual(second);
    });

    it('loses no update when several run at once', async () => {
      const counter = open().key<number>('counter', { initial: 0 });

      await Promise.all(Array.from({ length: 10 }, () => counter.update(async (current) => current + 1)));

      await expect(counter.get()).resolves.toMatchObject({ value: 10, revision: 10 });
    });

    it('keeps the value when the change throws', async () => {
      const board = open().key<Board>('board', { initial: { open: 0 } });
      await board.set({ open: 1 });

      await expect(
        board.update(() => {
          throw new Error('bad event');
        }),
      ).rejects.toThrow('bad event');
      await expect(board.get()).resolves.toMatchObject({ value: { open: 1 }, revision: 1 });
    });

    it('reads the initial value as a write would store it: a JSON copy, which a caller cannot change', async () => {
      const initial = { open: 0, tags: [] as string[], since: new Date(0) };
      const board = open().key('board', { initial });

      (await board.get()).value.tags.push('changed');

      await expect(board.get()).resolves.toEqual({
        value: { open: 0, tags: [], since: '1970-01-01T00:00:00.000Z' },
        revision: 0,
      });
    });

    it('refuses an initial value JSON cannot hold where the key is declared', () => {
      expect(() => open().key('count', { initial: BigInt(1) })).toThrow(InvalidResourceStoreError);
    });

    it('returns from a write the snapshot a read then serves', async () => {
      const board = open().key<{ since: Date }>('board');

      const written = await board.set({ since: new Date(0) });

      expect(written.value).toEqual({ since: '1970-01-01T00:00:00.000Z' });
      await expect(board.get()).resolves.toEqual(written);
    });

    it('is a key a resource can serve', () => {
      const key = open().key('board');
      const methods = { name: 'board', get: key.get, set: key.set, update: key.update, subscribe: key.subscribe };
      expect(isResourceKey(key)).toBe(true);
      expect(isResourceKey({ ...methods, store: key.store })).toBe(true);
      expect(isResourceKey(methods)).toBe(false);
      expect(isResourceKey({ ...methods, store: {} })).toBe(false);
      expect(isResourceKey({ name: 'board' })).toBe(false);
      expect(isResourceKey(undefined)).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('tells a key listener of each new revision, with the snapshot', async () => {
      const board = open().key<Board>('board', { initial: { open: 0 } });
      const seen: number[] = [];
      board.subscribe((snapshot) => seen.push(snapshot.revision));
      await new Promise((resolve) => setTimeout(resolve, 10));

      await board.set({ open: 1 });
      await until(() => seen.length === 1);
      await board.set({ open: 2 });
      await until(() => seen.length === 2);

      expect(seen).toEqual([1, 2]);
    });

    it('calls no key listener once it unsubscribed, even when a read had started', async () => {
      const board = open().key<Board>('board', { initial: { open: 0 } });
      const listener = jest.fn();
      const unsubscribe = board.subscribe(listener);
      await new Promise((resolve) => setTimeout(resolve, 10));
      let readStarted = false;
      let finishRead: () => void = () => undefined;
      const get = jest.spyOn(board, 'get').mockImplementationOnce(async () => {
        readStarted = true;
        await new Promise<void>((resolve) => (finishRead = resolve));
        return { value: { open: 1 }, revision: 1, updatedAt: new Date().toISOString() };
      });

      await board.set({ open: 1 });
      await until(() => readStarted);
      unsubscribe();
      finishRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(get).toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it('reads nothing for a change queued before it unsubscribed, so a closed store stays closed', async () => {
      const store = open();
      const board = store.key<Board>('board', { initial: { open: 0 } });
      const unsubscribe = board.subscribe(jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 10));
      let finishRead: () => void = () => undefined;
      const get = jest.spyOn(board, 'get').mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => (finishRead = resolve));
        return { value: { open: 0 }, revision: 0 };
      });

      await store.publish('board');
      await until(() => get.mock.calls.length === 1);
      await store.publish('board');
      await new Promise((resolve) => setTimeout(resolve, 30));
      unsubscribe();
      finishRead();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(get).toHaveBeenCalledTimes(1);
    });

    it('does not tell a key listener of a topic change that left the revision as it was', async () => {
      const store = open();
      const board = store.key<Board>('board', { initial: { open: 0 } });
      const listener = jest.fn();
      board.subscribe(listener);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.publish('board');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(listener).not.toHaveBeenCalled();
    });

    it('tells topic listeners of a publish, and nobody after they unsubscribe', async () => {
      const store = open();
      const listener = jest.fn();
      const unsubscribe = store.subscribe('dashboard', listener);
      await store.connect();

      await store.publish('dashboard');
      await until(() => listener.mock.calls.length === 1);
      unsubscribe();
      await store.publish('dashboard');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('reports a listener that throws, tells it of a revision once, and keeps telling the others', async () => {
      const onError = jest.fn();
      const store = open({ onError });
      const board = store.key<Board>('board', { initial: { open: 0 } });
      const others: number[] = [];
      const failing = jest.fn(() => {
        throw new Error('listener failed');
      });
      board.subscribe(failing);
      board.subscribe((snapshot) => others.push(snapshot.revision));
      await new Promise((resolve) => setTimeout(resolve, 10));

      await board.set({ open: 1 });
      await until(() => others.length === 1);
      await store.publish('board');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener failed' }));
      expect(failing).toHaveBeenCalledTimes(1);
    });
  });

  describe('on SQLite', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(pathJoin(os.tmpdir(), 'resource-store-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('keeps values in the file, so another store on it reads them', async () => {
      const path = pathJoin(dir, 'board.sqlite');
      const writer = open({ storage: { type: 'sqlite', sqlite: { path } } });
      const reader = open({ storage: { type: 'sqlite', sqlite: { path } } });

      await writer.key<Board>('board').set({ open: 5 });

      await expect(reader.key<Board>('board').get()).resolves.toMatchObject({ value: { open: 5 }, revision: 1 });
    });

    it('reports a value it cannot read while following a key, and calls no listener', async () => {
      const path = pathJoin(dir, 'board.sqlite');
      const onError = jest.fn();
      const store = open({ storage: { type: 'sqlite', sqlite: { path } }, onError });
      const listener = jest.fn();
      store.key<Board>('board').subscribe(listener);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const raw = await createStorage({ type: 'sqlite', sqlite: { path } });
      await raw.set('frontmcp-resources:value:board', 'not json');

      await store.publish('board');
      await until(() => onError.mock.calls.length > 0);
      await raw.disconnect();

      expect(listener).not.toHaveBeenCalled();
    });

    it('tells a listener of a write by another store on the file in this process', async () => {
      const path = pathJoin(dir, 'board.sqlite');
      const writer = open({ storage: { type: 'sqlite', sqlite: { path } } });
      const reader = open({ storage: { type: 'sqlite', sqlite: { path } } });
      const seen: number[] = [];
      reader.key<Board>('board').subscribe((snapshot) => seen.push(snapshot.revision));
      await new Promise((resolve) => setTimeout(resolve, 20));

      await writer.key<Board>('board').set({ open: 5 });

      await until(() => seen.length === 1);
      expect(seen).toEqual([1]);
    });
  });

  describe('a producer-backed key', () => {
    const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('runs the producer on the first read, and again only after a dirty mark', async () => {
      const produce = jest.fn(() => ({ open: 1 }));
      const board = open().key('board', { produce });

      await expect(board.get()).resolves.toMatchObject({ value: { open: 1 }, revision: 1 });
      await expect(board.get()).resolves.toMatchObject({ revision: 1 });
      expect(produce).toHaveBeenCalledTimes(1);
      board.markDirty();
      await board.get();

      expect(produce).toHaveBeenCalledTimes(2);
    });

    it('keeps the revision when the output has the same JSON, and moves it when it changes', async () => {
      let open_ = 1;
      const board = open().key('board', { produce: () => ({ open: open_ }) });
      await board.get();

      board.markDirty();
      await expect(board.get()).resolves.toMatchObject({ value: { open: 1 }, revision: 1 });
      open_ = 2;
      board.markDirty();
      await expect(board.get()).resolves.toMatchObject({ value: { open: 2 }, revision: 2 });
    });

    it('does not run while no one subscribes, however often it is marked dirty', async () => {
      const produce = jest.fn(() => 1);
      const board = open().key('board', { produce, minIntervalMs: 0 });

      for (let mark = 0; mark < 5; mark++) board.markDirty();
      await later(30);

      expect(produce).not.toHaveBeenCalled();
    });

    it('runs once for a burst of dirty marks while someone subscribes, and tells the listener of the new revision', async () => {
      let open_ = 0;
      const produce = jest.fn(() => ({ open: open_ }));
      const board = open().key('board', { produce, minIntervalMs: 0 });
      const revisions: number[] = [];
      const unsubscribe = board.subscribe((snapshot) => revisions.push(snapshot.revision));
      await until(() => revisions.length === 1);

      open_ = 1;
      for (let mark = 0; mark < 5; mark++) board.markDirty();
      await until(() => revisions.length === 2);
      await later(30);
      unsubscribe();

      expect(produce).toHaveBeenCalledTimes(2);
      expect(revisions).toEqual([1, 2]);
    });

    it('waits minIntervalMs after a run before the next one', async () => {
      const startedAt: number[] = [];
      const board = open().key('board', { produce: () => startedAt.push(Date.now()), minIntervalMs: 120 });
      const unsubscribe = board.subscribe(() => undefined);
      await until(() => startedAt.length === 1);

      board.markDirty();
      await until(() => startedAt.length === 2);
      unsubscribe();

      expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(100);
    });

    it('waits costFactor times as long as the last run took before the next one', async () => {
      const ended: number[] = [];
      const started: number[] = [];
      const board = open().key('board', {
        produce: async () => {
          started.push(Date.now());
          await later(60);
          ended.push(Date.now());
          return started.length;
        },
        minIntervalMs: 0,
        costFactor: 2,
      });
      const unsubscribe = board.subscribe(() => undefined);
      await until(() => ended.length === 1);

      board.markDirty();
      await until(() => started.length === 2);
      unsubscribe();

      expect(started[1] - ended[0]).toBeGreaterThanOrEqual(100);
    });

    it('stops running once the last subscriber leaves, and a read then runs it', async () => {
      const produce = jest.fn(() => 1);
      const board = open().key('board', { produce, minIntervalMs: 0 });
      const unsubscribe = board.subscribe(() => undefined);
      await until(() => produce.mock.calls.length === 1);
      unsubscribe();

      board.markDirty();
      await later(30);
      expect(produce).toHaveBeenCalledTimes(1);
      await board.get();

      expect(produce).toHaveBeenCalledTimes(2);
    });

    it('gives a read during an older run the output of a run after the latest dirty mark', async () => {
      let release: () => void = () => undefined;
      let runs = 0;
      const board = open().key('board', {
        produce: async () => {
          runs++;
          if (runs === 1) await new Promise<void>((resolve) => (release = resolve));
          return runs;
        },
      });

      const first = board.get();
      await until(() => runs === 1);
      board.markDirty();
      const second = board.get();
      release();

      await expect(first).resolves.toMatchObject({ value: 1 });
      await expect(second).resolves.toMatchObject({ value: 2 });
    });

    it('reports a failed run, fails the read, and does not rerun it until the next dirty mark', async () => {
      const onError = jest.fn();
      let fail = true;
      const produce = jest.fn(() => {
        if (fail) throw new Error('source offline');
        return 1;
      });
      const board = open({ onError }).key('board', { produce, minIntervalMs: 0 });
      const unsubscribe = board.subscribe(() => undefined);
      await until(() => onError.mock.calls.length === 1);
      await later(30);
      expect(produce).toHaveBeenCalledTimes(1);
      await expect(board.get()).rejects.toThrow('source offline');

      fail = false;
      board.markDirty();
      await until(() => produce.mock.calls.length === 3);
      unsubscribe();

      expect(onError.mock.calls[0][0]).toEqual(new Error('source offline'));
      await expect(board.get()).resolves.toMatchObject({ value: 1, revision: 1 });
    });

    it.each([
      [{ produce: 'board' }, 'produce'],
      [{ produce: () => 1, minIntervalMs: -1 }, 'minIntervalMs'],
      [{ produce: () => 1, costFactor: Number.POSITIVE_INFINITY }, 'costFactor'],
      [{ produce: () => 1, initial: 1 }, 'initial'],
    ])('refuses %j where it is declared', (options, path) => {
      expect(() => open().key('board', options as never)).toThrow(InvalidResourceStoreError);
      expect(() => open().key('board', options as never)).toThrow(path);
    });
  });

  describe('a key family', () => {
    it('gives the same key for the same parameters in any order, and keeps the values of each apart', async () => {
      const family = open().family<number>('cells', { initial: 0 });

      expect(family.key({ row: '1', column: 'a' })).toBe(family.key({ column: 'a', row: '1' }));
      await family.key({ row: '1', column: 'a' }).set(5);

      await expect(family.key({ row: '1', column: 'a' }).get()).resolves.toMatchObject({ value: 5, revision: 1 });
      await expect(family.key({ row: '2', column: 'a' }).get()).resolves.toEqual({ value: 0, revision: 0 });
    });

    it('runs a producer with the parameters of the key it computes', async () => {
      const family = open().family('stats', { produce: ({ table }) => `${table} rows` });

      await expect(family.key({ table: 'users' }).get()).resolves.toMatchObject({ value: 'users rows' });
    });

    it('forgets idle keys past 1000 parameter sets, but keeps one that someone subscribes to', async () => {
      const family = open().family('stats', { produce: ({ id }) => id });
      const subscribed = family.key({ id: 'kept' });
      const unsubscribe = subscribed.subscribe(() => undefined);
      const idle = family.key({ id: 'idle' });

      for (let id = 0; id < 1_000; id++) family.key({ id: String(id) });

      expect(family.key({ id: 'kept' })).toBe(subscribed);
      expect(family.key({ id: 'idle' })).not.toBe(idle);
      unsubscribe();
    });

    it('refuses a family without a name, and a producer that is not a function', () => {
      expect(() => open().family('')).toThrow(InvalidResourceStoreError);
      expect(() => open().family('stats', { produce: 1 } as never)).toThrow('produce');
    });
  });
});
