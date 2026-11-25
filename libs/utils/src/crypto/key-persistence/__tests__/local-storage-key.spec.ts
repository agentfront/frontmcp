/**
 * localStorage key records are encrypted with a non-extractable key kept in IndexedDB rather than one that can be
 * derived from localStorage itself (#1318), and records written under the derived key are copied to it, leaving them
 * for tabs still running 1.12 until the transition ends. Without IndexedDB, an encryptionKey is required (#1399).
 */
import { cryptoProvider } from '#crypto-provider';

import { LocalStorageAdapter } from '../../../storage/adapters/localstorage';
import { base64urlEncode, randomBytes } from '../../index';
import { createKeyPersistence, createKeyPersistenceWithStorage } from '../factory';
import {
  LocalStorageKeyLostError,
  LocalStorageKeyRequiredError,
  LocalStorageKeyUnavailableError,
  UnreadableKeyRecordError,
} from '../local-storage-key';

let browserLike = false;

jest.mock('../../runtime', () => {
  const runtime = jest.requireActual('../../runtime');
  return {
    ...runtime,
    isNode: () => !browserLike && runtime.isNode(),
    isBrowser: () => browserLike || runtime.isBrowser(),
  };
});

const RECORD_PREFIX = 'frontmcp:keys-v2:';
const DERIVED_RECORD_PREFIX = 'frontmcp:keys:';
const KEPT_KEY_ID = 'frontmcp:keys:';
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const SALT_KEPT_UNTIL_KEY = '__frontmcp_internal__:install_salt_kept_until';
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

const lsStore = new Map<string, string>();
/** Runs when localStorage is read, as another tab writing at that moment would. */
let onRead: ((key: string) => void) | undefined;
const lsMock: Storage = {
  getItem: (key: string) => {
    onRead?.(key);
    return lsStore.get(key) ?? null;
  },
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

/**
 * The parts of IndexedDB the key store uses: open, one object store, and get and put in a transaction. Its put runs
 * inside get, so two tabs creating the key at once can't be played out with it.
 */
function installFakeIndexedDB(options: { failOpen?: boolean } = {}): Map<string, unknown> {
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
        if (options.failOpen) {
          request.error = new Error('Connection to Indexed Database server lost');
          request.onerror?.();
          return;
        }
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
  return new LocalStorageAdapter({ prefix: DERIVED_RECORD_PREFIX, encryptionKey: derivedKey(salt) });
}

async function newSecret(kid: string) {
  return (await createKeyPersistence({ type: 'memory' })).getOrCreateSecret(kid);
}

describe('createKeyPersistence with localStorage', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: lsMock, writable: true, configurable: true });
  });

  beforeEach(() => {
    lsStore.clear();
    onRead = undefined;
  });

  afterEach(() => removeFakeIndexedDB());

  it('encrypts records with a non-extractable key kept in IndexedDB, and keeps no key material in localStorage', async () => {
    const kept = installFakeIndexedDB();

    const keys = await createKeyPersistence({ type: 'localstorage' });
    const secret = await keys.getOrCreateSecret('session');

    const storageKey = kept.get(KEPT_KEY_ID) as CryptoKey;
    expect(storageKey).toBeInstanceOf(CryptoKey);
    expect(storageKey.extractable).toBe(false);
    expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
    const record = lsStore.get(`${RECORD_PREFIX}session`) ?? '';
    expect(JSON.parse(record)).toMatchObject({ v: '', _enc: { alg: 'A256GCM' } });
    expect(record).not.toContain(secret.secret);

    const reopened = await createKeyPersistence({ type: 'localstorage', enableCache: false });
    expect(await reopened.getSecret('session')).toEqual(secret);
  });

  describe('records written under the derived key (1.12)', () => {
    it('copies them to the kept key and leaves them as they are until the transition ends', async () => {
      installFakeIndexedDB();
      const derived = recordsOfAnOlderTab();
      const secret = await newSecret('session');
      await derived.set('session', JSON.stringify(secret));

      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });

      expect(await keys.getSecret('session')).toEqual(secret);
      expect(JSON.parse((await derived.get('session')) ?? '{}')).toEqual(secret);
      expect(lsStore.has(INSTALL_SALT_KEY)).toBe(true);

      const now = Date.now();
      const later = jest.spyOn(Date, 'now').mockReturnValue(now + EIGHT_DAYS_MS);
      try {
        const afterTransition = await createKeyPersistence({ type: 'localstorage', enableCache: false });
        expect(await afterTransition.getSecret('session')).toEqual(secret);
        expect(lsStore.has(`${DERIVED_RECORD_PREFIX}session`)).toBe(false);
        expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
        expect(lsStore.has(SALT_KEPT_UNTIL_KEY)).toBe(false);
      } finally {
        later.mockRestore();
      }
    });

    it('lets a 1.12 tab still open after the copy keep its secret, rather than create one over it', async () => {
      installFakeIndexedDB();
      const olderTabRecords = recordsOfAnOlderTab();
      const secret = await newSecret('session');
      await olderTabRecords.set('session', JSON.stringify(secret));
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });

      const olderTab = createKeyPersistenceWithStorage(olderTabRecords, { enableCache: false });

      expect(await olderTab.getOrCreateSecret('session')).toEqual(secret);
      expect(await keys.getSecret('session')).toEqual(secret);
    });

    it('reads, and copies, a record a 1.12 tab writes after the copy', async () => {
      installFakeIndexedDB();
      const olderTab = recordsOfAnOlderTab();
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });

      const writtenLater = await newSecret('written-later');
      await olderTab.set('written-later', JSON.stringify(writtenLater));

      expect(await keys.getOrCreateSecret('written-later')).toEqual(writtenLater);
      expect(lsStore.has(`${RECORD_PREFIX}written-later`)).toBe(true);
    });

    it('takes a record another tab copies while it looks, rather than create one over it', async () => {
      installFakeIndexedDB();
      recordsOfAnOlderTab();
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      const otherTab = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      const copiedByOtherTab = await otherTab.getOrCreateSecret('race');
      const record = lsStore.get(`${RECORD_PREFIX}race`) ?? '';
      lsStore.delete(`${RECORD_PREFIX}race`);
      onRead = (key) => {
        if (key === `${DERIVED_RECORD_PREFIX}race`) lsStore.set(`${RECORD_PREFIX}race`, record);
      };

      expect(await keys.getOrCreateSecret('race')).toEqual(copiedByOtherTab);
    });

    it('resets a transition end further ahead than the transition lasts', async () => {
      installFakeIndexedDB();
      recordsOfAnOlderTab();
      lsStore.set(SALT_KEPT_UNTIL_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));

      await createKeyPersistence({ type: 'localstorage' });

      expect(Number(lsStore.get(SALT_KEPT_UNTIL_KEY))).toBeLessThanOrEqual(Date.now() + EIGHT_DAYS_MS);
    });
  });

  describe('records it cannot trust', () => {
    it('reads a record no key of the session reads as missing, and refuses to replace it', async () => {
      installFakeIndexedDB();
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      const otherKey = new LocalStorageAdapter({
        prefix: RECORD_PREFIX,
        encryptionKey: randomBytes(32),
        bindRecordKey: true,
      });
      await otherKey.set('foreign', JSON.stringify(await newSecret('foreign')));
      const record = lsStore.get(`${RECORD_PREFIX}foreign`);

      expect(await keys.getSecret('foreign')).toBeNull();
      expect(await keys.list()).not.toContain('foreign');
      await expect(keys.getOrCreateSecret('foreign')).rejects.toThrow(UnreadableKeyRecordError);
      expect(lsStore.get(`${RECORD_PREFIX}foreign`)).toBe(record);
    });

    it('does not read a record copied from another key id', async () => {
      installFakeIndexedDB();
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      await keys.getOrCreateSecret('signing');
      lsStore.set(`${RECORD_PREFIX}session`, lsStore.get(`${RECORD_PREFIX}signing`) ?? '');

      expect(await keys.getSecret('session')).toBeNull();
      await expect(keys.getOrCreateSecret('session')).rejects.toThrow(UnreadableKeyRecordError);
    });

    it('does not read a record written without encryption', async () => {
      installFakeIndexedDB();
      const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      lsStore.set(`${RECORD_PREFIX}planted`, JSON.stringify({ v: JSON.stringify(await newSecret('planted')) }));

      expect(await keys.getSecret('planted')).toBeNull();
      await expect(keys.getOrCreateSecret('planted')).rejects.toThrow(UnreadableKeyRecordError);
    });
  });

  describe('once the records use the IndexedDB key', () => {
    async function recordsUnderTheKeptKey() {
      const kept = installFakeIndexedDB();
      const secret = await (await createKeyPersistence({ type: 'localstorage' })).getOrCreateSecret('session');
      return { secret, storageKey: kept.get(KEPT_KEY_ID), record: lsStore.get(`${RECORD_PREFIX}session`) };
    }

    it('refuses, as one to retry, where IndexedDB is unavailable, and reads them once it is back', async () => {
      const { secret, storageKey, record } = await recordsUnderTheKeptKey();
      removeFakeIndexedDB();

      const refused = createKeyPersistence({ type: 'localstorage' });
      await expect(refused).rejects.toThrow(LocalStorageKeyUnavailableError);
      await expect(refused).rejects.not.toThrow(/remove/);
      expect(lsStore.get(`${RECORD_PREFIX}session`)).toBe(record);

      installFakeIndexedDB().set(KEPT_KEY_ID, storageKey);
      const reopened = await createKeyPersistence({ type: 'localstorage', enableCache: false });
      expect(await reopened.getSecret('session')).toEqual(secret);
    });

    it('refuses, as one to retry, where IndexedDB fails to open', async () => {
      const { record } = await recordsUnderTheKeptKey();
      installFakeIndexedDB({ failOpen: true });

      await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(LocalStorageKeyUnavailableError);
      expect(lsStore.get(`${RECORD_PREFIX}session`)).toBe(record);
    });

    it('refuses, writing no new key and saying how to start over, where IndexedDB opens without the key', async () => {
      const { record } = await recordsUnderTheKeptKey();
      const cleared = installFakeIndexedDB();

      const refused = createKeyPersistence({ type: 'localstorage' });
      await expect(refused).rejects.toThrow(LocalStorageKeyLostError);
      await expect(refused).rejects.toThrow(/remove the frontmcp:keys-v2: records/);
      expect(cleared.size).toBe(0);
      expect(lsStore.get(`${RECORD_PREFIX}session`)).toBe(record);
    });

    it("passes the refusal on from 'auto' instead of falling back to memory", async () => {
      await recordsUnderTheKeptKey();
      removeFakeIndexedDB();
      browserLike = true;
      try {
        await expect(createKeyPersistence({ type: 'auto' })).rejects.toThrow(LocalStorageKeyUnavailableError);
      } finally {
        browserLike = false;
      }
    });
  });

  describe('without IndexedDB', () => {
    it("refuses 'localstorage' without an encryptionKey, naming it, and writes nothing", async () => {
      await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(LocalStorageKeyRequiredError);
      await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(/encryptionKey/);
      expect(lsStore.size).toBe(0);
    });

    it("keeps 'auto' keys in memory without an encryptionKey, and warns once that saved keys are ignored", async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      recordsOfAnOlderTab();
      browserLike = true;
      try {
        const keys = await createKeyPersistence({ type: 'auto' });
        await keys.getOrCreateSecret('session');
        await createKeyPersistence({ type: 'auto' });

        expect(lsStore.has(`${RECORD_PREFIX}session`)).toBe(false);
        expect(lsStore.has(INSTALL_SALT_KEY)).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ignored \(not deleted\).*encryptionKey/));
      } finally {
        browserLike = false;
        warn.mockRestore();
      }
    });

    it('copies records written under the derived key to an encryptionKey it is given', async () => {
      const derived = recordsOfAnOlderTab();
      const secret = await newSecret('session');
      await derived.set('session', JSON.stringify(secret));

      const keys = await createKeyPersistence({
        type: 'localstorage',
        encryptionKey: randomBytes(32),
        enableCache: false,
      });

      expect(await keys.getSecret('session')).toEqual(secret);
      expect(lsStore.has(`${RECORD_PREFIX}session`)).toBe(true);
    });

    it('uses an encryptionKey it is given, with no salt', async () => {
      const keys = await createKeyPersistence({ type: 'localstorage', encryptionKey: randomBytes(32) });

      expect((await keys.getOrCreateSecret('session')).type).toBe('secret');
      expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
    });
  });
});
