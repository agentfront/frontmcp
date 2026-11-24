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
 * reader of localStorage alone cannot decrypt them. With `createIfMissing` false, `undefined` when the store opened
 * but holds no key. It throws where IndexedDB or WebCrypto is unavailable, or the store can't be opened or read.
 */
export async function loadLocalStorageKey(createIfMissing: boolean): Promise<CryptoKey | undefined> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) {
    throw new Error('IndexedDB or WebCrypto is unavailable');
  }
  const created = createIfMissing
    ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : undefined;
  const database = await openKeyDatabase();
  try {
    return await keepFirstKey(database, created);
  } finally {
    database.close();
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

/** The records use the key kept in IndexedDB, which this session can't load: they are left as they are. */
export class LocalStorageKeyUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'localStorage key records are encrypted with a key kept in IndexedDB, which could not be loaded in this ' +
        'session; they are left as they are. Try again once IndexedDB is available.',
      { cause },
    );
    this.name = 'LocalStorageKeyUnavailableError';
  }
}

/** The records use the key kept in IndexedDB, and IndexedDB opened without it: the browser cleared it. */
export class LocalStorageKeyLostError extends Error {
  constructor() {
    super(
      'The key kept in IndexedDB that encrypts the localStorage key records is gone, so they cannot be read. ' +
        'Restore it, or remove the frontmcp:keys-v2: records and __frontmcp_internal__:key_scheme from ' +
        'localStorage to start with new keys.',
    );
    this.name = 'LocalStorageKeyLostError';
  }
}

/** IndexedDB or WebCrypto is unavailable, so no key can be kept outside localStorage, and none was given. */
export class LocalStorageKeyRequiredError extends Error {
  constructor(cause: unknown) {
    super(
      'createKeyPersistence: IndexedDB or WebCrypto is unavailable, so localStorage key records need encryptionKey, ' +
        'a 32-byte key kept outside localStorage.',
      { cause },
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
