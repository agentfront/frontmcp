/**
 * Key records in localStorage, encrypted with a key kept outside it, and the move of records written under the key
 * 1.12 and earlier derived from localStorage itself.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { cryptoProvider } from '#crypto-provider';

import { LocalStorageAdapter } from '../../storage/adapters/localstorage';
import type { SetOptions, StorageAdapter } from '../../storage/types';
import { base64urlDecode } from '../index';
import {
  loadLocalStorageKey,
  LocalStorageKeyRequiredError,
  LocalStorageKeyUnavailableError,
  UnreadableKeyRecordError,
} from './local-storage-key';

const KEY_RECORD_PREFIX = 'frontmcp:keys:';
const LS_HKDF_IKM = new TextEncoder().encode('frontmcp:localstorage:v1');
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const LEGACY_SALT_KEY = 'frontmcp:_install_salt';
const SALT_KEPT_UNTIL_KEY = '__frontmcp_internal__:install_salt_kept_until';
/** Set once the records are encrypted with the key kept in IndexedDB, so no other key is ever used to read them. */
const KEPT_KEY_SCHEME_KEY = '__frontmcp_internal__:key_scheme';
const KEPT_KEY_SCHEME = 'indexeddb';
/** How long the derived key's salt is kept after the records moved, for tabs still running 1.12 that write with it. */
const DERIVED_KEY_TRANSITION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * localStorage key records under `encryptionKey`. A record it can't read is read with the key 1.12 derived from
 * localStorage while that key's salt is kept, and re-encrypted; one neither key reads is never replaced.
 */
class KeyRecordAdapter extends LocalStorageAdapter {
  constructor(
    encryptionKey: Uint8Array | CryptoKey,
    private readonly derived: LocalStorageAdapter | undefined,
  ) {
    super({ prefix: KEY_RECORD_PREFIX, encryptionKey });
  }

  override async get(key: string): Promise<string | null> {
    const value = await super.get(key);
    if (value !== null || !this.derived) {
      return value;
    }
    const derivedValue = await this.derived.get(key);
    if (derivedValue !== null) {
      await this.set(key, derivedValue);
    }
    return derivedValue;
  }

  override async set(key: string, value: string, options?: SetOptions): Promise<void> {
    if (await this.holdsUnreadableRecord(key)) {
      throw new UnreadableKeyRecordError(key);
    }
    await super.set(key, value, options);
  }

  /** Re-encrypt the records still under the derived key, and retire its salt once the transition is over. */
  async moveDerivedRecords(): Promise<void> {
    if (!this.derived) {
      return;
    }
    for (const key of await this.derived.keys()) {
      await this.get(key);
    }
    retireInstallationSalt();
  }

  private async holdsUnreadableRecord(key: string): Promise<boolean> {
    if (localStorage.getItem(`${KEY_RECORD_PREFIX}${key}`) === null) {
      return false;
    }
    return (await super.get(key)) === null && ((await this.derived?.get(key)) ?? null) === null;
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
  return new LocalStorageAdapter({ prefix: KEY_RECORD_PREFIX, encryptionKey });
}

/** Keep the salt for the transition after the records first moved, then remove it. */
function retireInstallationSalt(): void {
  const keptUntil = Number(localStorage.getItem(SALT_KEPT_UNTIL_KEY));
  if (!keptUntil) {
    localStorage.setItem(SALT_KEPT_UNTIL_KEY, String(Date.now() + DERIVED_KEY_TRANSITION_MS));
    return;
  }
  if (Date.now() < keptUntil) {
    return;
  }
  localStorage.removeItem(INSTALL_SALT_KEY);
  localStorage.removeItem(LEGACY_SALT_KEY);
  localStorage.removeItem(SALT_KEPT_UNTIL_KEY);
}

/** The non-extractable key kept in IndexedDB, created on first use; it throws where none can be kept or loaded. */
async function keptLocalStorageKey(): Promise<CryptoKey> {
  const usesKeptKey = localStorage.getItem(KEPT_KEY_SCHEME_KEY) === KEPT_KEY_SCHEME;
  const keptKey = await loadLocalStorageKey(!usesKeptKey);
  if (keptKey) {
    return keptKey;
  }
  throw usesKeptKey ? new LocalStorageKeyUnavailableError() : new LocalStorageKeyRequiredError();
}

/**
 * Key records in localStorage, encrypted with `encryptionKey`, or else with a non-extractable key kept in IndexedDB.
 * Records written under the key 1.12 and earlier derived from localStorage are moved to it.
 */
export async function createLocalStorageKeyAdapter(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  const adapter = new KeyRecordAdapter(encryptionKey ?? (await keptLocalStorageKey()), derivedKeyRecords());
  await adapter.connect();
  if (!encryptionKey) {
    localStorage.setItem(KEPT_KEY_SCHEME_KEY, KEPT_KEY_SCHEME);
  }
  await adapter.moveDerivedRecords();
  return adapter;
}
