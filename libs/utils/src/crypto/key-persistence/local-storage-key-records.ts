/**
 * Key records in localStorage, encrypted with a key kept outside it, and the copy of the records 1.12 and earlier
 * wrote under a key derived from localStorage itself.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { cryptoProvider } from '#crypto-provider';

import { LocalStorageAdapter } from '../../storage/adapters/localstorage';
import type { SetOptions, StorageAdapter } from '../../storage/types';
import { base64urlDecode } from '../index';
import {
  loadLocalStorageKey,
  LocalStorageKeyLostError,
  LocalStorageKeyRequiredError,
  LocalStorageKeyUnavailableError,
  UnreadableKeyRecordError,
} from './local-storage-key';

const KEY_RECORD_PREFIX = 'frontmcp:keys-v2:';
/** Where 1.12 and earlier keep the records, under the key derived from localStorage. */
const DERIVED_KEY_RECORD_PREFIX = 'frontmcp:keys:';
const LS_HKDF_IKM = new TextEncoder().encode('frontmcp:localstorage:v1');
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const LEGACY_SALT_KEY = 'frontmcp:_install_salt';
const SALT_KEPT_UNTIL_KEY = '__frontmcp_internal__:install_salt_kept_until';
/** Set once the records are encrypted with the key kept in IndexedDB, so no other key is ever used to read them. */
const KEPT_KEY_SCHEME_KEY = '__frontmcp_internal__:key_scheme';
const KEPT_KEY_SCHEME = 'indexeddb';
/** How long the records under the derived key stay as they are, for tabs still running 1.12 that read and write them. */
const DERIVED_KEY_TRANSITION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * localStorage key records under `encryptionKey`, each bound to its key id. A record missing here is copied from the
 * records under the key 1.12 derived from localStorage, while that key's salt is kept, and those are left as they are
 * for tabs still running 1.12. A record here that the key doesn't read is never replaced.
 */
class KeyRecordAdapter extends LocalStorageAdapter {
  constructor(
    encryptionKey: Uint8Array | CryptoKey,
    private readonly derived: LocalStorageAdapter | undefined,
  ) {
    super({ prefix: KEY_RECORD_PREFIX, encryptionKey, bindRecordKey: true });
  }

  override async get(key: string): Promise<string | null> {
    const value = await super.get(key);
    if (value !== null || !this.derived) {
      return value;
    }
    const derivedValue = await this.derived.get(key);
    // Read again before the caller creates the record: another tab may have copied it meanwhile.
    const copied = await super.get(key);
    if (copied !== null || derivedValue === null) {
      return copied;
    }
    if (!this.holdsRecord(key)) {
      await super.set(key, derivedValue);
    }
    return derivedValue;
  }

  override async set(key: string, value: string, options?: SetOptions): Promise<void> {
    if (this.holdsRecord(key) && (await super.get(key)) === null) {
      throw new UnreadableKeyRecordError(key);
    }
    await super.set(key, value, options);
  }

  override async delete(key: string): Promise<boolean> {
    const deletedDerived = (await this.derived?.delete(key)) ?? false;
    return (await super.delete(key)) || deletedDerived;
  }

  private holdsRecord(key: string): boolean {
    return localStorage.getItem(`${KEY_RECORD_PREFIX}${key}`) !== null;
  }

  /** Copy the records still only under the derived key; once the transition is over, remove them and the salt. */
  async copyDerivedRecords(): Promise<void> {
    if (!this.derived) {
      return;
    }
    const derivedKeys = await this.derived.keys();
    for (const key of derivedKeys) {
      await this.get(key);
    }
    if (!derivedKeyTransitionOver()) {
      return;
    }
    for (const key of derivedKeys) {
      await this.derived.delete(key);
    }
    localStorage.removeItem(INSTALL_SALT_KEY);
    localStorage.removeItem(LEGACY_SALT_KEY);
    localStorage.removeItem(SALT_KEPT_UNTIL_KEY);
  }
}

/** The salt 1.12 and earlier derived the localStorage key from, while it is kept. */
function readInstallationSalt(): Uint8Array | undefined {
  const stored = localStorage.getItem(INSTALL_SALT_KEY) ?? localStorage.getItem(LEGACY_SALT_KEY);
  if (!stored) {
    return undefined;
  }
  try {
    return base64urlDecode(stored);
  } catch {
    return undefined;
  }
}

/** The records under the key 1.12 and earlier derived from localStorage, while its salt is kept. */
function derivedKeyRecords(): LocalStorageAdapter | undefined {
  const salt = readInstallationSalt();
  if (!salt) {
    return undefined;
  }
  const origin = new TextEncoder().encode(typeof location !== 'undefined' ? location.origin : 'unknown');
  const encryptionKey = cryptoProvider.hkdfSha256(LS_HKDF_IKM, salt, origin, 32);
  return new LocalStorageAdapter({ prefix: DERIVED_KEY_RECORD_PREFIX, encryptionKey });
}

/** Whether the transition is over; it starts at the first copy, and a start date further ahead than it lasts is reset. */
function derivedKeyTransitionOver(): boolean {
  const now = Date.now();
  const keptUntil = Number(localStorage.getItem(SALT_KEPT_UNTIL_KEY));
  if (!keptUntil || keptUntil > now + DERIVED_KEY_TRANSITION_MS) {
    localStorage.setItem(SALT_KEPT_UNTIL_KEY, String(now + DERIVED_KEY_TRANSITION_MS));
    return false;
  }
  return now >= keptUntil;
}

/** The non-extractable key kept in IndexedDB, created on first use; it throws where none can be kept or loaded. */
async function keptLocalStorageKey(): Promise<CryptoKey> {
  const usesKeptKey = localStorage.getItem(KEPT_KEY_SCHEME_KEY) === KEPT_KEY_SCHEME;
  let keptKey: CryptoKey | undefined;
  try {
    keptKey = await loadLocalStorageKey(!usesKeptKey);
  } catch (error) {
    throw usesKeptKey ? new LocalStorageKeyUnavailableError(error) : new LocalStorageKeyRequiredError(error);
  }
  if (!keptKey) {
    throw new LocalStorageKeyLostError();
  }
  return keptKey;
}

/**
 * Key records in localStorage, encrypted with `encryptionKey`, or else with a non-extractable key kept in IndexedDB.
 * Records written under the key 1.12 and earlier derived from localStorage are copied to it.
 */
export async function createLocalStorageKeyAdapter(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  const adapter = new KeyRecordAdapter(encryptionKey ?? (await keptLocalStorageKey()), derivedKeyRecords());
  await adapter.connect();
  if (!encryptionKey) {
    localStorage.setItem(KEPT_KEY_SCHEME_KEY, KEPT_KEY_SCHEME);
  }
  await adapter.copyDerivedRecords();
  return adapter;
}
