/**
 * SessionCredentialVault — per-session, AES-256-GCM-encrypted credential store
 * (Checkpoint 3b).
 *
 * Persists the `credentials` a local `authenticate()` verifier returns
 * (Checkpoint 3a accepted-and-ignored them) and exposes them to tools via the
 * `this.credentials` ToolContext accessor.
 *
 * Security model
 * --------------
 * - Credentials are keyed by the authenticated subject (`sub`) behind a
 *   `sub → vaultId` indirection. Every fresh authorize mints a NEW random
 *   `vaultId` ({@link SessionCredentialVault.rotateVault}); the per-record
 *   encryption key is derived (HKDF salt) from that `vaultId`, so when a user
 *   disconnects and reconnects the old ciphertext becomes undecryptable and the
 *   reconnected session sees an EMPTY vault (per-session rotation).
 * - At-rest encryption is AES-256-GCM via the shared {@link VaultEncryption}
 *   primitive. The master pepper comes from `VAULT_SECRET ?? JWT_SECRET`; when
 *   neither is set a random per-process pepper is used and a warning is logged
 *   (credentials then do not survive a restart — fail-safe, never plaintext).
 * - The plaintext `secret` and `metadata` are NEVER written unencrypted. Only
 *   the unencrypted index (key names, vaultId pointer) is stored in the clear,
 *   and it carries no PII.
 *
 * Construct via {@link createSessionCredentialVault} (CLAUDE.md storage-factory
 * pattern) so the same `auth.tokenStorage` config backs both the token stores
 * and this vault.
 */

import { getEnv, randomUUID, type SetOptions, type StorageAdapter } from '@frontmcp/utils';

import { noopAuthLogger, type AuthLogger } from '../common/auth-logger.interface';
import { VaultEncryption, type EncryptedData } from './vault-encryption';

/**
 * A stored credential value: the secret plus optional non-secret metadata.
 */
export interface StoredCredential {
  /** The secret value (token, api key, …). Encrypted at rest. */
  secret: string;
  /** Optional non-secret metadata stored alongside the credential (encrypted). */
  metadata?: Record<string, unknown>;
}

/**
 * Options for {@link SessionCredentialVault}.
 */
export interface SessionCredentialVaultOptions {
  /** Connected storage adapter backing the vault (memory / Redis / SQLite). */
  storage: StorageAdapter;
  /**
   * Master pepper for key derivation. When omitted, falls back to
   * `VAULT_SECRET ?? JWT_SECRET`, and finally a random per-process value (with a
   * warning). Defense-in-depth: even with a stolen vaultId an attacker still
   * needs this pepper to derive the AES key.
   */
  pepper?: string;
  /** Key prefix for all stored keys. @default 'mcp:cred:' */
  keyPrefix?: string;
  /** TTL (ms) for credential entries. @default undefined (no expiry) */
  ttlMs?: number;
  /** TTL (ms) for the pending-authorize accumulator. @default 600000 (10 min) */
  pendingTtlMs?: number;
  /** Scoped logger. @default noop */
  logger?: AuthLogger;
}

/** Internal: the encrypted record stored per credential. */
interface EncryptedCredentialRecord {
  /** AES-256-GCM envelope of the JSON-serialized {@link StoredCredential}. */
  enc: EncryptedData;
}

/** Internal: the pending-authorize accumulator. */
interface PendingCredentialBatch {
  sub: string;
  vaultId: string;
  /** Encrypted credential records, keyed by credential key. */
  creds: Record<string, EncryptedCredentialRecord>;
}

const DEFAULT_KEY_PREFIX = 'mcp:cred:';
const DEFAULT_PENDING_TTL_MS = 600_000; // 10 minutes — matches PENDING_AUTH_TTL_MS

/**
 * Per-session encrypted credential vault.
 *
 * @see createSessionCredentialVault for the factory entry point.
 */
export class SessionCredentialVault {
  private readonly storage: StorageAdapter;
  private readonly encryption: VaultEncryption;
  private readonly keyPrefix: string;
  private readonly ttlMs?: number;
  private readonly pendingTtlMs: number;
  private readonly logger: AuthLogger;
  /** Cache of derived AES keys, keyed by `${sub}:${vaultId}`. */
  private readonly keyCache = new Map<string, Promise<Uint8Array>>();

  constructor(options: SessionCredentialVaultOptions) {
    this.storage = options.storage;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttlMs = options.ttlMs;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.logger = options.logger ?? noopAuthLogger;

    const pepper = options.pepper ?? resolveVaultPepper(this.logger);
    this.encryption = new VaultEncryption({ pepper, hkdfInfo: 'frontmcp-session-credential-vault-v1' });
  }

  // ============================================
  // Storage-key helpers
  // ============================================

  /** `cred:idx:<sub>` → current vaultId (the sub → vaultId indirection). */
  private indexKey(sub: string): string {
    return `${this.keyPrefix}idx:${sub}`;
  }

  /** `cred:keys:<sub>:<vaultId>` → JSON array of credential key names (the SET). */
  private keysKey(sub: string, vaultId: string): string {
    return `${this.keyPrefix}keys:${sub}:${vaultId}`;
  }

  /** `cred:data:<sub>:<vaultId>:<key>` → encrypted credential record. */
  private dataKey(sub: string, vaultId: string, key: string): string {
    return `${this.keyPrefix}data:${sub}:${vaultId}:${key}`;
  }

  /** `cred:pending:<pendingId>` → encrypted pending-authorize accumulator. */
  private pendingKey(pendingId: string): string {
    return `${this.keyPrefix}pending:${pendingId}`;
  }

  /** Convert the configured `ttlMs` into `SetOptions` (storage uses `ttlSeconds`). */
  private get credentialSetOpts(): SetOptions | undefined {
    return this.ttlMs ? { ttlSeconds: Math.ceil(this.ttlMs / 1000) } : undefined;
  }

  // ============================================
  // Key derivation
  // ============================================

  /**
   * Derive (and cache) the AES-256 key for a `(sub, vaultId)` pair. The vaultId
   * acts as the HKDF salt, so rotating it makes prior ciphertext undecryptable.
   */
  private deriveKey(sub: string, vaultId: string): Promise<Uint8Array> {
    const cacheKey = `${sub}:${vaultId}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached) return cached;
    // VaultEncryption.deriveKey mixes jti/vaultKey/sub/iat + pepper. We map our
    // per-session identifiers onto those slots: jti=vaultId (the rotating salt),
    // vaultKey=vaultId, sub=sub. iat is fixed (0) so the same (sub,vaultId)
    // always derives the same key within and across processes (given the pepper).
    const promise = this.encryption.deriveKey({ jti: vaultId, vaultKey: vaultId, sub, iat: 0 });
    this.keyCache.set(cacheKey, promise);
    return promise;
  }

  // ============================================
  // vaultId indirection
  // ============================================

  /**
   * Read the current vaultId for a subject, or undefined when the subject has no
   * live vault (never authorized, or rotated away).
   */
  async getVaultId(sub: string): Promise<string | undefined> {
    const raw = await this.storage.get(this.indexKey(sub));
    return raw ?? undefined;
  }

  /**
   * Mint a FRESH vaultId for a subject and point the indirection at it. Called
   * at the start of each authorize so reconnect = empty vault. Returns the new
   * vaultId. The old vaultId's ciphertext is left in storage but is
   * unreachable (no index pointer) and undecryptable (different derived key);
   * it expires via TTL when configured.
   */
  async rotateVault(sub: string): Promise<string> {
    const vaultId = randomUUID();
    await this.storage.set(this.indexKey(sub), vaultId, this.credentialSetOpts);
    return vaultId;
  }

  // ============================================
  // Credential CRUD (committed vault)
  // ============================================

  /**
   * Encrypt + store a single credential into the vault identified by
   * `(sub, vaultId)` and add its key to the key set. Used both to commit
   * authorize-time credentials and to additively add a credential mid-session.
   */
  async store(sub: string, vaultId: string, key: string, value: StoredCredential): Promise<void> {
    const aesKey = await this.deriveKey(sub, vaultId);
    const enc = await this.encryption.encryptObject(this.normalize(value), aesKey);
    const record: EncryptedCredentialRecord = { enc };
    await this.storage.set(this.dataKey(sub, vaultId, key), JSON.stringify(record), this.credentialSetOpts);
    await this.addKeyToSet(sub, vaultId, key);
  }

  /**
   * Decrypt and return a credential by key for a subject's CURRENT vault.
   * Returns undefined when there is no live vault or no such key, or when
   * decryption fails (e.g. a stale pointer to rotated-away ciphertext).
   */
  async get(sub: string, key: string): Promise<StoredCredential | undefined> {
    const vaultId = await this.getVaultId(sub);
    if (!vaultId) return undefined;
    const raw = await this.storage.get(this.dataKey(sub, vaultId, key));
    if (!raw) return undefined;
    try {
      const record = JSON.parse(raw) as EncryptedCredentialRecord;
      const aesKey = await this.deriveKey(sub, vaultId);
      return await this.encryption.decryptObject<StoredCredential>(record.enc, aesKey);
    } catch (err) {
      // Wrong key (rotated vault) or corrupted/tampered data — fail closed.
      this.logger.warn(`SessionCredentialVault: failed to read credential "${key}": ${errMsg(err)}`);
      return undefined;
    }
  }

  /**
   * List the credential keys available in a subject's current vault. Returns an
   * empty array when there is no live vault (e.g. after rotation on reconnect).
   */
  async list(sub: string): Promise<string[]> {
    const vaultId = await this.getVaultId(sub);
    if (!vaultId) return [];
    return this.readKeySet(sub, vaultId);
  }

  /**
   * Remove a credential by key from a subject's current vault (deletes the
   * ciphertext and drops the key from the set). No-op when absent.
   */
  async remove(sub: string, key: string): Promise<void> {
    const vaultId = await this.getVaultId(sub);
    if (!vaultId) return;
    await this.storage.delete(this.dataKey(sub, vaultId, key));
    const keys = await this.readKeySet(sub, vaultId);
    const next = keys.filter((k) => k !== key);
    if (next.length !== keys.length) {
      await this.writeKeySet(sub, vaultId, next);
    }
  }

  // ============================================
  // Authorize-time accumulation + commit
  // ============================================

  /**
   * Stage credentials returned by `authenticate()` under a pending id, encrypted
   * against a freshly-rotated vaultId for `sub`. They are NOT visible to tools
   * until {@link commit} flushes them — this lets the authorize flow accumulate
   * credentials before the subject's identity is final.
   *
   * @returns the vaultId the credentials were staged against.
   */
  async stage(pendingId: string, sub: string, credentials: Array<{ key: string } & StoredCredential>): Promise<string> {
    const vaultId = await this.rotateVault(sub);
    const creds: Record<string, EncryptedCredentialRecord> = {};
    for (const cred of credentials) {
      const aesKey = await this.deriveKey(sub, vaultId);
      const { key, ...value } = cred;
      creds[key] = { enc: await this.encryption.encryptObject(this.normalize(value), aesKey) };
    }
    const batch: PendingCredentialBatch = { sub, vaultId, creds };
    await this.storage.set(this.pendingKey(pendingId), JSON.stringify(batch), {
      ttlSeconds: Math.ceil(this.pendingTtlMs / 1000),
    });
    return vaultId;
  }

  /**
   * Flush a staged batch into the live vault, binding it to `sub`. The staged
   * batch's `sub` must equal the supplied `sub` (the one baked into the minted
   * token) — a mismatch is refused so credentials can never be committed under a
   * different identity than the one that will read them.
   *
   * @returns true when a batch was committed, false when none was staged.
   */
  async commit(pendingId: string, sub: string): Promise<boolean> {
    const raw = await this.storage.get(this.pendingKey(pendingId));
    if (!raw) return false;
    let batch: PendingCredentialBatch;
    try {
      batch = JSON.parse(raw) as PendingCredentialBatch;
    } catch {
      await this.storage.delete(this.pendingKey(pendingId));
      return false;
    }
    if (batch.sub !== sub) {
      // Identity mismatch — never bind credentials to a different subject.
      this.logger.warn('SessionCredentialVault: pending batch subject mismatch on commit; discarding');
      await this.storage.delete(this.pendingKey(pendingId));
      return false;
    }

    // Point the indirection at the staged vaultId and write each credential.
    await this.storage.set(this.indexKey(sub), batch.vaultId, this.credentialSetOpts);
    const keys: string[] = [];
    for (const [key, record] of Object.entries(batch.creds)) {
      await this.storage.set(this.dataKey(sub, batch.vaultId, key), JSON.stringify(record), this.credentialSetOpts);
      keys.push(key);
    }
    await this.writeKeySet(sub, batch.vaultId, keys);
    await this.storage.delete(this.pendingKey(pendingId));
    return true;
  }

  // ============================================
  // Key-set helpers
  // ============================================

  private async readKeySet(sub: string, vaultId: string): Promise<string[]> {
    const raw = await this.storage.get(this.keysKey(sub, vaultId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  private async writeKeySet(sub: string, vaultId: string, keys: string[]): Promise<void> {
    // De-duplicate (the key set is a SET, mirroring the customer's design).
    const unique = [...new Set(keys)];
    await this.storage.set(this.keysKey(sub, vaultId), JSON.stringify(unique), this.credentialSetOpts);
  }

  private async addKeyToSet(sub: string, vaultId: string, key: string): Promise<void> {
    const keys = await this.readKeySet(sub, vaultId);
    if (!keys.includes(key)) {
      keys.push(key);
      await this.writeKeySet(sub, vaultId, keys);
    }
  }

  /** Strip undefined metadata so the encrypted JSON stays minimal. */
  private normalize(value: StoredCredential): StoredCredential {
    return value.metadata === undefined ? { secret: value.secret } : { secret: value.secret, metadata: value.metadata };
  }
}

/**
 * Resolve the vault pepper from the environment, warning (and using a random
 * per-process fallback) when neither `VAULT_SECRET` nor `JWT_SECRET` is set.
 */
function resolveVaultPepper(logger: AuthLogger): string {
  const fromEnv = getEnv('VAULT_SECRET') ?? getEnv('JWT_SECRET');
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  logger.warn(
    'SessionCredentialVault: neither VAULT_SECRET nor JWT_SECRET is set; using a random per-process pepper. ' +
      'Stored credentials will NOT survive a restart and cannot be shared across instances. ' +
      'Set VAULT_SECRET (or JWT_SECRET) for persistent, multi-instance credential storage.',
  );
  return randomUUID() + randomUUID();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
