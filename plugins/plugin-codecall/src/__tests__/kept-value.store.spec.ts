import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResultOwner } from '@frontmcp/plugin-result-handles';
import { createMemoryStorage, createStorage, mkdtemp, rm, type StorageConfig } from '@frontmcp/utils';

import { KeptValueStore } from '../kept-values/kept-value.store';
import type { KeptValue } from '../kept-values/kept-value.types';
import { jsonBytes } from '../runs/run-journal';

const alice: ResultOwner = { session: 'session-1', caller: 'alice' };
const TOKEN = '__REF_0b8e2f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b__';

function reference(data: string, id = TOKEN): KeptValue {
  return { reference: { id, data, source: 'tool-result', origin: 'codecall:keep' } };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-kept-store-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each<[string, () => StorageConfig]>([
  ['memory', () => ({ type: 'memory' })],
  ['sqlite', () => ({ type: 'sqlite', sqlite: { path: join(dir, 'kept.sqlite') } })],
])('KeptValueStore on %s storage', (_, storageConfig) => {
  let store: KeptValueStore;

  beforeAll(async () => {
    const storage = (await createStorage(storageConfig())).namespace('codecall-kept');
    store = new KeptValueStore(storage, { ttlSeconds: 60, maxBytes: 1024 * 1024 });
  });

  afterAll(async () => {
    await store.onShutdown();
  });

  it('recalls a value for the owner that kept it', async () => {
    await store.keep(alice, 'overdue', { value: [{ id: 1 }, { id: 2 }] });

    expect(await store.recall(alice, 'overdue')).toEqual({ value: [{ id: 1 }, { id: 2 }] });
  });

  it.each<[string, ResultOwner]>([
    ['another session', { session: 'session-2', caller: 'alice' }],
    ['another caller in the same session', { session: 'session-1', caller: 'mallory' }],
    ['an anonymous caller in the same session', { session: 'session-1' }],
  ])('recalls nothing for %s', async (__, other) => {
    await store.keep(alice, 'mine', { value: 'secret' });

    expect(await store.recall(other, 'mine')).toBeUndefined();
  });

  it('recalls nothing for a name never kept', async () => {
    expect(await store.recall(alice, 'never-kept')).toBeUndefined();
  });

  it('forgets a value after its TTL', async () => {
    await store.keep(alice, 'short-lived', { value: 1 });
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

    expect(await store.recall(alice, 'short-lived')).toBeUndefined();
  });

  it('gives the live large values of the names asked for, as sidecar entries', async () => {
    const owner = { session: 'references' };
    await store.keep(owner, 'doc', reference('x'.repeat(2048)));
    await store.keep(owner, 'other-doc', reference('y'.repeat(2048), TOKEN.replace('0b8e', '1b8e')));
    await store.keep(owner, 'small', { value: 'text' });

    expect(await store.referencesOf(owner, ['doc', 'small', 'missing'])).toEqual([
      { id: TOKEN, data: 'x'.repeat(2048), source: 'tool-result', origin: 'codecall:keep' },
    ]);
  });
});

describe('KeptValueStore limits', () => {
  async function memoryStore(maxBytes: number) {
    const root = createMemoryStorage();
    await root.connect();
    const storage = root.namespace('codecall-kept');
    return { root, storage, store: new KeptValueStore(storage, { ttlSeconds: 60, maxBytes }) };
  }

  it('refuses a value that would take the owner past maxBytes, and keeps what it had', async () => {
    const first: KeptValue = { value: 'a'.repeat(600) };
    const { store } = await memoryStore(1024);
    await store.keep(alice, 'first', first);

    await expect(store.keep(alice, 'second', { value: 'b'.repeat(600) })).rejects.toThrow(
      `Keeping "second" (${jsonBytes({ value: 'b'.repeat(600) })} bytes)`,
    );
    await expect(store.keep(alice, 'second', { value: 'b'.repeat(600) })).rejects.toBeInstanceOf(RangeError);
    expect(await store.recall(alice, 'second')).toBeUndefined();
    expect(await store.recall(alice, 'first')).toEqual(first);
    await expect(store.keep(alice, 'small', { value: 'c'.repeat(300) })).resolves.toBeUndefined();
  });

  it('counts only the newest value of a name, each owner on its own', async () => {
    const { store } = await memoryStore(1024);

    for (let round = 0; round < 5; round++) {
      await store.keep(alice, 'progress', { value: String(round).repeat(600) });
    }
    await store.keep({ session: 'session-2' }, 'progress', { value: 'z'.repeat(600) });

    expect(await store.recall(alice, 'progress')).toEqual({ value: '4'.repeat(600) });
  });

  it('stops counting a value at most twice its TTL after it was kept', async () => {
    const { store } = await memoryStore(1024);
    await store.keep(alice, 'old', { value: 'a'.repeat(600) });
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 121_000);

    await expect(store.keep(alice, 'new', { value: 'b'.repeat(600) })).resolves.toBeUndefined();
  });

  it('counts every value of keeps that run at the same time, on two instances', async () => {
    const { storage, store } = await memoryStore(1024);
    const otherInstance = new KeptValueStore(storage, { ttlSeconds: 60, maxBytes: 1024 });

    await Promise.all([
      store.keep(alice, 'a', { value: 'a'.repeat(400) }),
      otherInstance.keep(alice, 'b', { value: 'b'.repeat(400) }),
    ]);

    await expect(store.keep(alice, 'c', { value: 'c'.repeat(400) })).rejects.toBeInstanceOf(RangeError);
    expect(await store.recall(alice, 'a')).toEqual({ value: 'a'.repeat(400) });
    expect(await store.recall(alice, 'b')).toEqual({ value: 'b'.repeat(400) });
  });

  it('releases what a keep reserved when it fails before writing the value', async () => {
    const { storage, store } = await memoryStore(1024);
    await store.keep(alice, 'report', { value: 'a'.repeat(400) });
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('storage down'));

    await expect(store.keep(alice, 'other', { value: 'b'.repeat(400) })).rejects.toThrow('storage down');

    await expect(store.keep(alice, 'other', { value: 'c'.repeat(400) })).resolves.toBeUndefined();
  });

  it('keeps counting a keep whose value write fails, which may have been applied, and the value it would replace', async () => {
    const { storage, store } = await memoryStore(1024);
    await store.keep(alice, 'report', { value: 'a'.repeat(400) });
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('connection lost'));

    await expect(store.keep(alice, 'report', { value: 'b'.repeat(400) })).rejects.toThrow('connection lost');

    expect(await store.recall(alice, 'report')).toEqual({ value: 'a'.repeat(400) });
    await expect(store.keep(alice, 'other', { value: 'c'.repeat(400) })).rejects.toBeInstanceOf(RangeError);
  });

  describe('with a fixed clock', () => {
    const MINUTE = 60_000;
    const windowStart = (window: number) => 1000 * MINUTE + window * MINUTE;

    it('gives a replacement room for the value it replaces while the counters checked hold its bytes', async () => {
      const { store } = await memoryStore(1024);
      jest.spyOn(Date, 'now').mockReturnValue(windowStart(0) + 30_000);
      await store.keep(alice, 'report', { value: 'a'.repeat(600) });

      jest.spyOn(Date, 'now').mockReturnValue(windowStart(1) + 10_000);
      await expect(store.keep(alice, 'report', { value: 'b'.repeat(600) })).resolves.toBeUndefined();
    });

    it('gives no room for a value whose bytes count in a window no longer checked', async () => {
      const { store } = await memoryStore(1024);
      jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(windowStart(0) + 59_900)
        .mockReturnValue(windowStart(1) + 100);
      await store.keep(alice, 'report', { value: 'a'.repeat(600) });

      jest.spyOn(Date, 'now').mockReturnValue(windowStart(2) + 50);
      expect(await store.recall(alice, 'report')).toEqual({ value: 'a'.repeat(600) });
      await expect(store.keep(alice, 'report', { value: 'b'.repeat(1400) })).rejects.toBeInstanceOf(RangeError);
    });
  });

  it('keeps values encrypted, under keys that name neither the value nor its owner', async () => {
    const { root, store } = await memoryStore(1024);
    await store.keep(alice, 'overdue', { value: ['invoice-17'] });

    const keys = await root.keys('*');
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^codecall-kept:/);
      expect(key).not.toContain('overdue');
      const stored = (await root.get(key)) ?? '';
      expect(stored).not.toContain('invoice-17');
      expect(stored).not.toContain('overdue');
      expect(stored).not.toContain('alice');
    }
  });
});
