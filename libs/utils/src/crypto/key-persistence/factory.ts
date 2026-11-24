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
import { base64urlDecode, base64urlEncode, randomBytes } from '../index';
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
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const LEGACY_SALT_KEY = 'frontmcp:_install_salt';
/** Set once the records are encrypted with the key kept in IndexedDB, so no other key is ever used to read them. */
const KEPT_KEY_SCHEME_KEY = '__frontmcp_internal__:key_scheme';
const KEPT_KEY_SCHEME = 'indexeddb';

type LocalStorageAdapterClass = typeof import('../../storage/adapters/localstorage.js').LocalStorageAdapter;

let derivedKeyWarned = false;

/**
 * Get or create a per-installation random salt stored in localStorage.
 * This ensures the derived key is unique per browser installation.
 */
function getOrCreateInstallationSalt(): Uint8Array {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable: cannot derive installation salt');
  }
  const existing = localStorage.getItem(INSTALL_SALT_KEY);
  if (existing) {
    try {
      return base64urlDecode(existing);
    } catch {
      // Corrupted salt — regenerate
    }
  }

  // Migrate from legacy key if present
  const legacy = localStorage.getItem(LEGACY_SALT_KEY);
  if (legacy) {
    try {
      const salt = base64urlDecode(legacy);
      localStorage.setItem(INSTALL_SALT_KEY, base64urlEncode(salt));
      localStorage.removeItem(LEGACY_SALT_KEY);
      return salt;
    } catch {
      localStorage.removeItem(LEGACY_SALT_KEY);
    }
  }

  const salt = randomBytes(32);
  localStorage.setItem(INSTALL_SALT_KEY, base64urlEncode(salt));
  return salt;
}

/** The key 1.12.2 and earlier use for localStorage records: HKDF of a fixed IKM, the installation salt and the origin. */
function deriveLocalStorageKey(): Uint8Array {
  const salt = getOrCreateInstallationSalt();
  const origin = typeof location !== 'undefined' ? location.origin : 'unknown';
  return cryptoProvider.hkdfSha256(LS_HKDF_IKM, salt, new TextEncoder().encode(origin), 32);
}

/**
 * Key records in localStorage, encrypted with `encryptionKey`, or else with a non-extractable key kept in IndexedDB.
 * Where IndexedDB or WebCrypto is unavailable, the key 1.12.2 derives from localStorage is kept, with a warning,
 * unless the records already use the IndexedDB key: then it throws rather than read them with another key.
 */
async function createLocalStorageKeyAdapter(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
  if (encryptionKey) return new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey });
  const keptKey = await loadLocalStorageKey();
  if (!keptKey && localStorage.getItem(KEPT_KEY_SCHEME_KEY) === KEPT_KEY_SCHEME) {
    throw new Error(
      'localStorage key records are encrypted with a key kept in IndexedDB, which could not be loaded; ' +
        'they are not read with another key',
    );
  }
  if (!keptKey) {
    if (!derivedKeyWarned) {
      derivedKeyWarned = true;
      console.warn(
        '[frontmcp] createKeyPersistence: IndexedDB or WebCrypto is unavailable, so localStorage key records are ' +
          'encrypted with a key derived from localStorage itself, which anyone who can read it can derive. Pass ' +
          'encryptionKey, a 32-byte key kept outside localStorage; from 1.13 localStorage key records need it here.',
      );
    }
    return new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey: deriveLocalStorageKey() });
  }
  const adapter = new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey: keptKey });
  await adapter.connect();
  localStorage.setItem(KEPT_KEY_SCHEME_KEY, KEPT_KEY_SCHEME);
  await moveDerivedKeyRecords(adapter, LocalStorageAdapter);
  return adapter;
}

/**
 * Re-encrypt the records written under the derived key with `adapter`'s key, then remove the salt, so localStorage no
 * longer holds what decrypts them.
 */
async function moveDerivedKeyRecords(
  adapter: StorageAdapter,
  LocalStorageAdapter: LocalStorageAdapterClass,
): Promise<void> {
  if (localStorage.getItem(INSTALL_SALT_KEY) === null && localStorage.getItem(LEGACY_SALT_KEY) === null) return;
  const derived = new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey: deriveLocalStorageKey() });
  for (const kid of await derived.keys()) {
    const record = await derived.get(kid);
    if (record !== null) await adapter.set(kid, record);
  }
  localStorage.removeItem(INSTALL_SALT_KEY);
}

/**
 * Create a KeyPersistence instance with auto-detected storage.
 *
 * In Node.js: Uses filesystem storage at `.frontmcp/keys/` by default
 * In browser: Uses IndexedDB (persistent) with localStorage fallback
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
