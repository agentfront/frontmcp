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
 * reader of localStorage alone cannot decrypt them. `undefined` where IndexedDB or WebCrypto is unavailable.
 */
export async function loadLocalStorageKey(): Promise<CryptoKey | undefined> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return undefined;
  try {
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
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

/** The key kept already, else `created`, kept now, in one read-write transaction so that tabs opening together agree. */
function keepFirstKey(database: IDBDatabase, created: CryptoKey): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let kept = created;
    const lookup = store.get(KEY_ID);
    lookup.onsuccess = () => {
      if (lookup.result) kept = lookup.result as CryptoKey;
      else store.put(created, KEY_ID);
    };
    transaction.oncomplete = () => resolve(kept);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
