import { createMemoryStorage, createStorage } from '@frontmcp/utils';

import { createStorageReplayNonceStore, StorageReplayNonceStore } from '../security/replay-nonce-store';

jest.mock('@frontmcp/utils', () => ({ ...jest.requireActual('@frontmcp/utils'), createStorage: jest.fn() }));

const createStorageMock = jest.mocked(createStorage);

async function connectedMemoryStorage() {
  const storage = createMemoryStorage({ enableSweeper: false });
  await storage.connect();
  return storage;
}

describe('StorageReplayNonceStore', () => {
  it('records a key once, with the TTL rounded up to whole seconds, and again once the TTL expired', async () => {
    const storage = await connectedMemoryStorage();
    const store = new StorageReplayNonceStore(storage);
    const startedAt = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(startedAt);

    try {
      const first = await store.claim('jti-hash', 1_500);
      const ttlSeconds = await storage.ttl('jti-hash');
      const replayed = await store.claim('jti-hash', 1_500);
      clock.mockReturnValue(startedAt + 2_001);
      const afterExpiry = await store.claim('jti-hash', 1_500);

      expect([first, replayed, afterExpiry]).toEqual([true, false, true]);
      expect(ttlSeconds).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps a key for at least a second when the window ends now', async () => {
    const storage = await connectedMemoryStorage();

    await new StorageReplayNonceStore(storage).claim('at-the-boundary', 0);

    expect(await storage.ttl('at-the-boundary')).toBe(1);
  });

  it('lets only one of two concurrent claims of a key win', async () => {
    const shared = await connectedMemoryStorage();
    const firstReplica = new StorageReplayNonceStore(shared);
    const secondReplica = new StorageReplayNonceStore(shared);

    const outcomes = await Promise.all([firstReplica.claim('raced', 60_000), secondReplica.claim('raced', 60_000)]);

    expect(outcomes.sort()).toEqual([false, true]);
  });
});

describe('createStorageReplayNonceStore', () => {
  afterEach(() => {
    createStorageMock.mockReset();
  });

  it('connects on the first claim, never falling back to memory, and keys under the namespace', async () => {
    const storage = await connectedMemoryStorage();
    createStorageMock.mockResolvedValue(storage);
    const store = createStorageReplayNonceStore({ type: 'redis', redis: { url: 'redis://replay:6379' } }, 'jti:acme');

    expect(createStorageMock).not.toHaveBeenCalled();
    const first = await store.claim('nonce-hash', 60_000);
    const replayed = await store.claim('nonce-hash', 60_000);

    expect([first, replayed]).toEqual([true, false]);
    expect(createStorageMock).toHaveBeenCalledTimes(1);
    expect(createStorageMock).toHaveBeenCalledWith({
      type: 'redis',
      redis: { url: 'redis://replay:6379' },
      fallback: 'error',
    });
    expect(await storage.keys('*')).toEqual(['jti:acme:nonce-hash']);
  });

  it('throws while the storage cannot connect, and connects again on the next claim', async () => {
    const storage = await connectedMemoryStorage();
    createStorageMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue(storage);
    const store = createStorageReplayNonceStore({ type: 'redis' }, 'jti:acme');

    await expect(store.claim('nonce-hash', 60_000)).rejects.toThrow('ECONNREFUSED');
    await expect(store.claim('nonce-hash', 60_000)).resolves.toBe(true);
    expect(createStorageMock).toHaveBeenCalledTimes(2);
  });
});
