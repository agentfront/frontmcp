/**
 * Factory functions for KeyPersistence.
 *
 * Provides convenient ways to create KeyPersistence instances
 * with auto-detection of storage backend.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { cryptoProvider } from '#crypto-provider';

import { MemoryStorageAdapter } from '../../storage/adapters/memory';
import type { StorageAdapter } from '../../storage/types';
import { base64urlDecode } from '../index';
import { isBrowser, isNode } from '../runtime';
import { KeyPersistence } from './key-persistence';
import { loadLocalStorageKey } from './local-storage-key';
import type { CreateKeyPersistenceOptions } from './types';

/**
 * Default base directory for filesystem storage.
 */
const DEFAULT_BASE_DIR = '.frontmcp/keys';

const KEY_RECORD_PREFIX = 'frontmcp:keys:';
const LS_HKDF_IKM = new TextEncoder().encode('frontmcp:localstorage:v1');
/** Where 1.12.2 and earlier kept the salt of the key they derived for localStorage records; the second is older still. */
const DERIVED_KEY_SALT_KEYS = ['__frontmcp_internal__:install_salt', 'frontmcp:_install_salt'];

type LocalStorageAdapterClass = typeof import('../../storage/adapters/localstorage.js').LocalStorageAdapter;

/**
 * Key records in localStorage, encrypted with `encryptionKey`, or else with a non-extractable key kept in IndexedDB:
 * never with one that could be derived from localStorage. Throws where neither key is available.
 */
async function createLocalStorageKeyAdapter(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
  if (encryptionKey) return new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey });
  const keptKey = await loadLocalStorageKey();
  if (!keptKey) {
    throw new Error(
      'localStorage key records are encrypted with a key kept in IndexedDB, which is unavailable here: ' +
        'pass encryptionKey, a 32-byte key kept outside localStorage',
    );
  }
  const adapter = new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey: keptKey });
  await adapter.connect();
  await moveDerivedKeyRecords(adapter, LocalStorageAdapter);
  return adapter;
}

/** The key 1.12.2 and earlier derived from `salt` and the page origin; `undefined` for a salt that doesn't decode. */
function derivedLocalStorageKey(salt: string): Uint8Array | undefined {
  const origin = typeof location !== 'undefined' ? location.origin : 'unknown';
  try {
    return cryptoProvider.hkdfSha256(LS_HKDF_IKM, base64urlDecode(salt), new TextEncoder().encode(origin), 32);
  } catch {
    return undefined;
  }
}

/**
 * Re-encrypt the records written under the key 1.12.2 and earlier derived from a salt in localStorage with `adapter`'s
 * key, then remove the salt, so localStorage no longer holds what decrypts them.
 */
async function moveDerivedKeyRecords(
  adapter: StorageAdapter,
  LocalStorageAdapter: LocalStorageAdapterClass,
): Promise<void> {
  for (const saltKey of DERIVED_KEY_SALT_KEYS) {
    const salt = localStorage.getItem(saltKey);
    if (salt === null) continue;
    const derivedKey = derivedLocalStorageKey(salt);
    if (derivedKey) {
      const derived = new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey: derivedKey });
      for (const kid of await derived.keys()) {
        const record = await derived.get(kid);
        if (record !== null) await adapter.set(kid, record);
      }
    }
    localStorage.removeItem(saltKey);
  }
}

/**
 * Create a KeyPersistence instance with auto-detected storage.
 *
 * In Node.js: Uses filesystem storage at `.frontmcp/keys/` by default
 * In browser: Uses IndexedDB (persistent), then localStorage, whose records need a key kept in IndexedDB or `encryptionKey`
 * Fallback: Memory storage (keys lost on restart)
 *
 * @param options - Configuration options
 * @returns KeyPersistence instance (storage already connected)
 *
 * @example
 * ```typescript
 * // Auto-detect storage
 * const keys = await createKeyPersistence();
 *
 * // Force memory storage
 * const memKeys = await createKeyPersistence({ type: 'memory' });
 *
 * // Force IndexedDB (browser)
 * const idbKeys = await createKeyPersistence({ type: 'indexeddb' });
 *
 * // Force localStorage (browser)
 * const lsKeys = await createKeyPersistence({ type: 'localstorage' });
 *
 * // Custom directory for filesystem
 * const fsKeys = await createKeyPersistence({
 *   type: 'filesystem',
 *   baseDir: '.my-app/keys',
 * });
 * ```
 */
export async function createKeyPersistence(options?: CreateKeyPersistenceOptions): Promise<KeyPersistence> {
  const type = options?.type ?? 'auto';
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;

  let adapter: StorageAdapter;

  if (type === 'memory') {
    adapter = new MemoryStorageAdapter();
  } else if (type === 'filesystem') {
    const { FileSystemStorageAdapter } = await import('../../storage/adapters/filesystem.js');
    adapter = new FileSystemStorageAdapter({ baseDir });
  } else if (type === 'indexeddb') {
    const { IndexedDBStorageAdapter } = await import('../../storage/adapters/indexeddb.js');
    adapter = new IndexedDBStorageAdapter({ prefix: 'frontmcp:keys:' });
  } else if (type === 'localstorage') {
    adapter = await createLocalStorageKeyAdapter(options?.encryptionKey);
  } else {
    // Auto-detect with fallback chain: filesystem → indexeddb → localStorage → memory
    let connected = false;

    if (isNode()) {
      try {
        const { FileSystemStorageAdapter } = await import('../../storage/adapters/filesystem.js');
        adapter = new FileSystemStorageAdapter({ baseDir });
        await adapter.connect();
        connected = true;
      } catch {
        adapter = new MemoryStorageAdapter();
      }
    } else if (isBrowser() && typeof indexedDB !== 'undefined') {
      try {
        const { IndexedDBStorageAdapter } = await import('../../storage/adapters/indexeddb.js');
        adapter = new IndexedDBStorageAdapter({ prefix: 'frontmcp:keys:' });
        await adapter.connect();
        connected = true;
      } catch {
        // Fall through to localStorage
        if (typeof localStorage !== 'undefined') {
          try {
            adapter = await createLocalStorageKeyAdapter(options?.encryptionKey);
            await adapter.connect();
            connected = true;
          } catch {
            adapter = new MemoryStorageAdapter();
          }
        } else {
          adapter = new MemoryStorageAdapter();
        }
      }
    } else if (isBrowser() && typeof localStorage !== 'undefined') {
      try {
        adapter = await createLocalStorageKeyAdapter(options?.encryptionKey);
        await adapter.connect();
        connected = true;
      } catch {
        adapter = new MemoryStorageAdapter();
      }
    } else {
      adapter = new MemoryStorageAdapter();
    }

    if (!connected) {
      await adapter.connect();
    }
  }

  if (type !== 'auto') {
    await adapter.connect();
  }

  return new KeyPersistence({
    storage: adapter,
    throwOnInvalid: options?.throwOnInvalid ?? false,
    enableCache: options?.enableCache ?? true,
  });
}

/**
 * Create a KeyPersistence instance with an explicit storage adapter.
 *
 * Use this when you want to provide your own storage backend
 * (e.g., Redis, custom adapter).
 *
 * Note: The storage adapter must already be connected.
 *
 * @param storage - Connected storage adapter
 * @param options - Additional options
 * @returns KeyPersistence instance
 *
 * @example
 * ```typescript
 * import { createStorage } from '@frontmcp/utils';
 *
 * // Use Redis for distributed key storage
 * const redis = await createStorage({ type: 'redis' });
 * const keys = createKeyPersistenceWithStorage(redis);
 * ```
 */
export function createKeyPersistenceWithStorage(
  storage: StorageAdapter,
  options?: Pick<CreateKeyPersistenceOptions, 'throwOnInvalid' | 'enableCache'>,
): KeyPersistence {
  return new KeyPersistence({
    storage,
    throwOnInvalid: options?.throwOnInvalid ?? false,
    enableCache: options?.enableCache ?? true,
  });
}
