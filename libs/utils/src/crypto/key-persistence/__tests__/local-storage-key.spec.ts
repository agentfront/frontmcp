/**
 * localStorage key records are encrypted with a non-extractable key kept in IndexedDB, never with one that can be
 * derived from localStorage itself (#1318). Records written under the derived key of 1.12.2 and earlier are moved to it.
 */
import { cryptoProvider } from '#crypto-provider';

import { LocalStorageAdapter } from '../../../storage/adapters/localstorage';
import { base64urlEncode, randomBytes } from '../../index';
import { createKeyPersistence } from '../factory';

const RECORD_PREFIX = 'frontmcp:keys:';
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';

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

  it('moves records written under the derived key to the kept key, and drops the salt', async () => {
    installFakeIndexedDB();
    const salt = randomBytes(32);
    lsStore.set(INSTALL_SALT_KEY, base64urlEncode(salt));
    const derived = new LocalStorageAdapter({ prefix: RECORD_PREFIX, encryptionKey: derivedKey(salt) });
    const earlier = await createKeyPersistence({ type: 'memory' });
    const secret = await earlier.getOrCreateSecret('session');
    await derived.set('session', JSON.stringify(secret));

    const keys = await createKeyPersistence({ type: 'localstorage', enableCache: false });

    expect(await keys.getSecret('session')).toEqual(secret);
    expect(lsStore.has(INSTALL_SALT_KEY)).toBe(false);
    expect(await derived.get('session')).toBeNull();
  });

  it('refuses without IndexedDB, unless given an encryptionKey', async () => {
    await expect(createKeyPersistence({ type: 'localstorage' })).rejects.toThrow(/encryptionKey/);

    const keys = await createKeyPersistence({ type: 'localstorage', encryptionKey: randomBytes(32) });
    expect((await keys.getOrCreateSecret('session')).type).toBe('secret');
  });
});
