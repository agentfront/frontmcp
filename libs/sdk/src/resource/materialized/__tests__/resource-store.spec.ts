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

    it('is a key a resource can serve', () => {
      expect(isResourceKey(open().key('board'))).toBe(true);
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
});
