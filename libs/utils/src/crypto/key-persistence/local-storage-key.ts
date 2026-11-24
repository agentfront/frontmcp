/**
 * The key that encrypts localStorage key records, kept outside localStorage.
 *
 * @module @frontmcp/utils/key-persistence
 */

const DATABASE_NAME = 'frontmcp-key-persistence';
const STORE_NAME = 'local-storage-keys';
const KEY_ID = 'frontmcp:keys:';

/**
 * The AES-GCM key for localStorage key records: created non-extractable on first use and kept in IndexedDB, so a
 * reader of localStorage alone cannot decrypt them. With `createIfMissing` false, a missing key is not created.
 * `undefined` where IndexedDB or WebCrypto is unavailable, or the key is missing and not to be created.
 */
export async function loadLocalStorageKey(createIfMissing: boolean): Promise<CryptoKey | undefined> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return undefined;
  try {
    const created = createIfMissing
      ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      : undefined;
    const database = await openKeyDatabase();
    try {
      return await keepFirstKey(database, created);
    } finally {
      database.close();
    }
  } catch {
    return undefined;
  }
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The key kept already, else `created` kept now, in one read-write transaction so that tabs opening together agree. */
function keepFirstKey(database: IDBDatabase, created: CryptoKey | undefined): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let kept = created;
    const lookup = store.get(KEY_ID);
    lookup.onsuccess = () => {
      if (lookup.result) kept = lookup.result as CryptoKey;
      else if (created) store.put(created, KEY_ID);
    };
    transaction.oncomplete = () => resolve(kept);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The records use the key kept in IndexedDB, which can't be loaded: they are left as they are, not read with another key. */
export class LocalStorageKeyUnavailableError extends Error {
  constructor() {
    super(
      'localStorage key records are encrypted with a key kept in IndexedDB, which could not be loaded; they are not ' +
        'read with another key. Restore IndexedDB, or remove the frontmcp:keys: records and ' +
        '__frontmcp_internal__:key_scheme from localStorage to start with new keys.',
    );
    this.name = 'LocalStorageKeyUnavailableError';
  }
}

/** IndexedDB or WebCrypto is unavailable, so no key can be kept outside localStorage, and none was given. */
export class LocalStorageKeyRequiredError extends Error {
  constructor() {
    super(
      'createKeyPersistence: IndexedDB or WebCrypto is unavailable, so localStorage key records need encryptionKey, ' +
        'a 32-byte key kept outside localStorage.',
    );
    this.name = 'LocalStorageKeyRequiredError';
  }
}

/** A key record is in localStorage, but no key this session has reads it, so it is not replaced. */
export class UnreadableKeyRecordError extends Error {
  constructor(kid: string) {
    super(`localStorage key record "${kid}" can't be read with this session's key, so it is not replaced`);
    this.name = 'UnreadableKeyRecordError';
  }
}
