/**
 * localStorage key records are encrypted with a non-extractable key kept in IndexedDB rather than one that can be
 * derived from localStorage itself (#1318), and records written under the derived key are moved to it. Without
 * IndexedDB, an encryptionKey is required (#1399).
 */
import { cryptoProvider } from '#crypto-provider';

import { LocalStorageAdapter } from '../../../storage/adapters/localstorage';
import { base64urlEncode, randomBytes } from '../../index';
import { createKeyPersistence } from '../factory';
import { LocalStorageKeyRequiredError, UnreadableKeyRecordError } from '../local-storage-key';

let browserLike = false;

jest.mock('../../runtime', () => {
  const runtime = jest.requireActual('../../runtime');
  return {
    ...runtime,
    isNode: () => !browserLike && runtime.isNode(),
    isBrowser: () => browserLike || runtime.isBrowser(),
  };
});

const RECORD_PREFIX = 'frontmcp:keys:';
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const SALT_KEPT_UNTIL_KEY = '__frontmcp_internal__:install_salt_kept_until';
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

const lsStore = new Map<string, string>();
const lsMock: Storage = {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    lsStore.set(key, value);
  },
  removeItem: (key: string) => {
    lsStore.delete(key);
  },
  clear: () => lsStore.clear(),
  get length() {
    return lsStore.size;
  },
  key: (index: number) => [...lsStore.keys()][index] ?? null,
};

interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

/** The parts of IndexedDB the key store uses: open, one object store, and get and put in a transaction. */
function installFakeIndexedDB(): Map<string, unknown> {
  const records = new Map<string, unknown>();
  let upgraded = false;
  const later = (callback: () => void) => setTimeout(callback, 0);
  const database = {
    createObjectStore: () => {
      upgraded = true;
    },
    close: () => undefined,
    transaction: () => {
      const transaction = { oncomplete: null as (() => void) | null, onerror: null, onabort: null, error: null };
      return Object.assign(transaction, {
        objectStore: () => ({
          get: (id: string) => {
            const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
            later(() => {
              request.result = records.get(id);
              request.onsuccess?.();
              later(() => transaction.oncomplete?.());
            });
            return request;
          },
          put: (value: unknown, id: string) => {
            records.set(id, value);
          },
        }),
      });
    },
  };
  const factory = {
    open: () => {
      const request: FakeRequest = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      later(() => {
        if (!upgraded) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, writable: true, configurable: true });
  return records;
}

function removeFakeIndexedDB(): void {
  Reflect.deleteProperty(globalThis, 'indexedDB');
}

/** The key 1.12.2 and earlier derived from the salt in localStorage. */
function derivedKey(salt: Uint8Array): Uint8Array {
  const info = new TextEncoder().encode(typeof location !== 'undefined' ? location.origin : 'unknown');
  return cryptoProvider.hkdfSha256(new TextEncoder().encode('frontmcp:localstorage:v1'), salt, info, 32);
}

/** Records as a tab still running 1.12 writes them: under the key derived from a salt kept in localStorage. */
function recordsOfAnOlderTab(): LocalStorageAdapter {
  const salt = randomBytes(32);
  lsStore.set(INSTALL_SALT_KEY, base64urlEncode(salt));
  return new LocalStorageAdapter({ prefix: RECORD_PREFIX, encryptionKey: derivedKey(salt) });
}

async function newSecret(kid: string) {
  return (await createKeyPersistence({ type: 'memory' })).getOrCreateSecret(kid);
}

describe('createKeyPersistence with localStorage', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: lsMock, writable: true, configurable: true });
  });

  beforeEach(() => lsStore.clear());

  afterEach(() => removeFakeIndexedDB());

  it('encrypts records with a non-extractable key kept in IndexedDB, and keeps no key material in localStorage', async () => {
    const kept = installFakeIndexedDB();

    const keys = await createKeyPersistence({ type: 'localstorage' });
    const secret = await keys.getOrCreateSecret('session');

    const storageKey = kept.get(RECORD_PREFIX) as CryptoKey;
    expect(storageKey).toBeInstanceOf(CryptoKey);
    expect(storageKey.extractable).toBe(false);
    expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
    const record = lsStore.get(`${RECORD_PREFIX}session`) ?? '';
    expect(JSON.parse(record)).toMatchObject({ v: '', _enc: { alg: 'A256GCM' } });
    expect(record).not.toContain(secret.secret);

    const reopened = await createKeyPersistence({ type: 'localstorage', enableCache: false });
    expect(await reopened.getSecret('session')).toEqual(secret);
  });

  it('moves records written under the derived key to the kept key, and keeps the salt only for a transition', async () => {
    installFakeIndexedDB();
    const derived = recordsOfAnOlderTab();
    const secret = await newSecret('session');
    await derived.set('session', JSON.stringify(secret));

    const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });

    expect(await keys.getSecret('session')).toEqual(secret);
    expect(await derived.get('session')).toBeNull();
    expect(lsStore.has(INSTALL_SALT_KEY)).toBe(true);

    const now = Date.now();
    const later = jest.spyOn(Date, 'now').mockReturnValue(now + EIGHT_DAYS_MS);
    try {
      const afterTransition = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      expect(await afterTransition.getSecret('session')).toEqual(secret);
      expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
      expect(lsStore.has(SALT_KEPT_UNTIL_KEY)).toBe(false);
    } finally {
      later.mockRestore();
    }
  });

  it('reads, and moves, a record a 1.12 tab writes with the derived key after the records moved', async () => {
    installFakeIndexedDB();
    const olderTab = recordsOfAnOlderTab();
    await olderTab.set('session', JSON.stringify(await newSecret('session')));
    const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
    await keys.getSecret('session');

    const writtenLater = await newSecret('written-later');
    await olderTab.set('written-later', JSON.stringify(writtenLater));

    expect(await keys.getOrCreateSecret('written-later')).toEqual(writtenLater);
    expect(await olderTab.get('written-later')).toBeNull();
  });

  it('reads a record no key of the session reads as missing, and refuses to replace it', async () => {
    installFakeIndexedDB();
    const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
    const otherKey = new LocalStorageAdapter({ prefix: RECORD_PREFIX, encryptionKey: randomBytes(32) });
    await otherKey.set('foreign', JSON.stringify(await newSecret('foreign')));
    const record = lsStore.get(`${RECORD_PREFIX}foreign`);

    expect(await keys.getSecret('foreign')).toBeNull();
    expect(await keys.list()).not.toContain('foreign');
    await expect(keys.getOrCreateSecret('foreign')).rejects.toThrow(UnreadableKeyRecordError);
    expect(lsStore.get(`${RECORD_PREFIX}foreign`)).toBe(record);
  });

  it('refuses, keeping its records, when the IndexedDB key they use can no longer be loaded', async () => {
    const kept = installFakeIndexedDB();
    const secret = await (await createKeyPersistence({ type: 'localstorage' })).getOrCreateSecret('session');
    const storageKey = kept.get(RECORD_PREFIX);
    const record = lsStore.get(`${RECORD_PREFIX}session`);
    removeFakeIndexedDB();

    await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(/key kept in IndexedDB/);
    expect(lsStore.get(`${RECORD_PREFIX}session`)).toBe(record);

    installFakeIndexedDB().set(RECORD_PREFIX, storageKey);
    const reopened = await createKeyPersistence({ type: 'localstorage', enableCache: false });
    expect(await reopened.getSecret('session')).toEqual(secret);
  });

  it('refuses, writing no new key, when IndexedDB was cleared but localStorage still holds records under its key', async () => {
    installFakeIndexedDB();
    await (await createKeyPersistence({ type: 'localstorage' })).getOrCreateSecret('session');
    const record = lsStore.get(`${RECORD_PREFIX}session`);
    const cleared = installFakeIndexedDB();

    await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(/key kept in IndexedDB/);
    expect(cleared.size).toBe(0);
    expect(lsStore.get(`${RECORD_PREFIX}session`)).toBe(record);
  });

  it("propagates the refusal from 'auto' instead of falling back to memory", async () => {
    installFakeIndexedDB();
    await (await createKeyPersistence({ type: 'localstorage' })).getOrCreateSecret('session');
    removeFakeIndexedDB();
    browserLike = true;
    try {
      await expect(createKeyPersistence({ type: 'auto' })).rejects.toThrow(/key kept in IndexedDB/);
    } finally {
      browserLike = false;
    }
  });

  it("without IndexedDB or an encryptionKey, refuses 'localstorage', naming encryptionKey, and writes nothing", async () => {
    await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(LocalStorageKeyRequiredError);
    await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(/encryptionKey/);
    expect(lsStore.size).toBe(0);
  });

  it("without IndexedDB or an encryptionKey, keeps 'auto' keys in memory and warns once, naming encryptionKey", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    browserLike = true;
    try {
      const keys = await createKeyPersistence({ type: 'auto' });
      await keys.getOrCreateSecret('session');
      await createKeyPersistence({ type: 'auto' });

      expect(lsStore.has(`${RECORD_PREFIX}session`)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('encryptionKey'));
    } finally {
      browserLike = false;
      warn.mockRestore();
    }
  });

  it('without IndexedDB, moves records written under the derived key to an encryptionKey it is given', async () => {
    const derived = recordsOfAnOlderTab();
    const secret = await newSecret('session');
    await derived.set('session', JSON.stringify(secret));
    const encryptionKey = randomBytes(32);

    await createKeyPersistence({ type: 'localstorage', encryptionKey });

    const keptWithKey = new LocalStorageAdapter({ prefix: RECORD_PREFIX, encryptionKey });
    expect(JSON.parse((await keptWithKey.get('session')) ?? '{}')).toEqual(secret);
  });

  it('without IndexedDB, uses an encryptionKey it is given, with no salt', async () => {
    const keys = await createKeyPersistence({ type: 'localstorage', encryptionKey: randomBytes(32) });

    expect((await keys.getOrCreateSecret('session')).type).toBe('secret');
    expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
  });
});
