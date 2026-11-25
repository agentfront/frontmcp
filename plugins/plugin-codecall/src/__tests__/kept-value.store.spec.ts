import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createResultHandleStore, ResultHandleStore, type ResultOwner } from '@frontmcp/plugin-result-handles';
import { createMemoryStorage, mkdtemp, rm, type StorageConfig } from '@frontmcp/utils';

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
    const handles = await createResultHandleStore({
      storage: storageConfig(),
      namespace: 'codecall-kept',
      ttlSeconds: 60,
    });
    store = new KeptValueStore(handles, { ttlSeconds: 60, maxBytes: 1024 * 1024 });
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
    const store = new KeptValueStore(new ResultHandleStore(root.namespace('codecall-kept'), 60), {
      ttlSeconds: 60,
      maxBytes,
    });
    return { root, store };
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
  });

  it('counts only the newest value of a name, each owner on its own', async () => {
    const { store } = await memoryStore(1024);

    for (let round = 0; round < 5; round++) {
      await store.keep(alice, 'progress', { value: String(round).repeat(600) });
    }
    await store.keep({ session: 'session-2' }, 'progress', { value: 'z'.repeat(600) });

    expect(await store.recall(alice, 'progress')).toEqual({ value: '4'.repeat(600) });
  });

  it('stops counting a value once it expired', async () => {
    const { store } = await memoryStore(1024);
    await store.keep(alice, 'old', { value: 'a'.repeat(600) });
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

    await expect(store.keep(alice, 'new', { value: 'b'.repeat(600) })).resolves.toBeUndefined();
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
