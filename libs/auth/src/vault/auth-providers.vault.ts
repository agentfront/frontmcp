/**
 * AuthProvidersVault - Keeps auth provider credentials between requests, each encrypted under its own key with a TTL
 */

import type { Token } from '@frontmcp/di';
import {
  EncryptedTypedStorage,
  hkdfSha256,
  MAX_TTL_SECONDS,
  randomBytes,
  sha256Hex,
  type NamespacedStorage,
  type StorageAdapter,
} from '@frontmcp/utils';

import type { AuthLogger } from '../common/auth-logger.interface';
import { AuthInvalidInputError, CredentialStorageError } from '../errors/auth-internal.errors';
import type { AppCredential, Credential } from '../session';
import type { CredentialScope } from './auth-providers.types';
import { extractCredentialExpiry } from './credential-helpers';

/** Session id prefix of a caller without a verified session, whose session credentials are never stored. */
export const UNIDENTIFIED_SESSION_PREFIX = 'unidentified:';

const DEFAULT_CREDENTIAL_TTL_MS = 3_600_000;
const ENCRYPTION_KEY_INFO = new TextEncoder().encode('frontmcp-auth-providers-vault-v1');

/**
 * Options of an AuthProvidersVault
 */
export interface AuthProvidersVaultStorageOptions {
  /** Prefix of every key the vault writes (default: 'authproviders:') */
  namespace?: string;
  /** How long a credential without an expiry is kept, in ms (default: 3600000 = 1 hour) */
  defaultCacheTtl?: number;
  /** Secret the encryption key is derived from; without one, the key is random and only this process holds it */
  pepper?: string;
  logger?: AuthLogger;
}

/** A credential as stored, encrypted with the key it was written under, so a record copied to another key isn't read */
interface StoredCredential {
  storageKey: string;
  appCredential: AppCredential;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}

function encryptionKeyFrom(pepper: string | undefined): Uint8Array {
  if (!pepper) return randomBytes(32);
  return hkdfSha256(new TextEncoder().encode(pepper), new Uint8Array(0), ENCRYPTION_KEY_INFO, 32);
}

/**
 * AuthProvidersVault - Storage layer for auth provider credentials
 */
export class AuthProvidersVault {
  private readonly credentials: EncryptedTypedStorage<StoredCredential>;
  private readonly namespace: string;
  private readonly defaultCacheTtl: number;
  private readonly logger?: AuthLogger;

  constructor(storage: StorageAdapter | NamespacedStorage, options: AuthProvidersVaultStorageOptions = {}) {
    this.credentials = new EncryptedTypedStorage<StoredCredential>(storage, {
      keys: [{ kid: 'authproviders-v1', key: encryptionKeyFrom(options.pepper) }],
    });
    this.namespace = options.namespace ?? 'authproviders:';
    this.defaultCacheTtl = positiveOr(options.defaultCacheTtl, DEFAULT_CREDENTIAL_TTL_MS);
    this.logger = options.logger;
  }

  /**
   * Store a credential in the vault, until it expires; one without an expiry for `cacheTtl`, else `defaultCacheTtl`
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param credential - Credential to store
   * @param scope - Credential scope
   * @param userId - User ID (required for user scope)
   * @param cacheTtl - How long to keep a credential without an expiry, in ms
   */
  async storeCredential<T extends Credential>(
    sessionId: string,
    providerId: string,
    credential: T,
    scope: CredentialScope,
    userId?: string,
    cacheTtl?: number,
  ): Promise<void> {
    if (scope === 'session' && sessionId.startsWith(UNIDENTIFIED_SESSION_PREFIX)) {
      this.logger?.debug(`Not storing credential "${providerId}": the caller has no verified session`);
      return;
    }

    const key = this.credentialKey(sessionId, providerId, scope, userId);
    const appCredential: AppCredential = {
      appId: this.namespace,
      providerId,
      credential,
      acquiredAt: Date.now(),
      isValid: true,
      expiresAt: extractCredentialExpiry(credential),
    };

    try {
      await this.write(key, appCredential, cacheTtl);
      this.logger?.debug(`Stored credential "${providerId}" with scope "${scope}"`);
    } catch (error) {
      this.logger?.warn(`Failed to store credential "${providerId}":`, error);
      throw error;
    }
  }

  /**
   * Get a credential from the vault
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param scope - Credential scope
   * @param userId - User ID (required for user scope)
   * @returns Credential or null if not found
   */
  async getCredential<T extends Credential>(
    sessionId: string,
    providerId: string,
    scope: CredentialScope,
    userId?: string,
  ): Promise<T | null> {
    const key = this.credentialKey(sessionId, providerId, scope, userId);

    try {
      const appCredential = await this.read(key);

      if (!appCredential) {
        return null;
      }

      if (!appCredential.isValid) {
        this.logger?.debug(`Credential "${providerId}" is marked as invalid`);
        return null;
      }

      if (appCredential.expiresAt && Date.now() >= appCredential.expiresAt) {
        this.logger?.debug(`Credential "${providerId}" has expired`);
        return null;
      }

      return appCredential.credential as T;
    } catch (error) {
      this.logger?.warn(`Failed to get credential "${providerId}":`, error);
      // Re-throw storage errors so callers can distinguish "not found" from storage failure
      if (error instanceof CredentialStorageError) {
        throw error;
      }
      throw new CredentialStorageError(
        `Storage error while retrieving credential "${providerId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Remove a credential from the vault
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param scope - Credential scope
   * @param userId - User ID (required for user scope)
   */
  async removeCredential(
    sessionId: string,
    providerId: string,
    scope: CredentialScope,
    userId?: string,
  ): Promise<void> {
    const key = this.credentialKey(sessionId, providerId, scope, userId);

    try {
      await this.credentials.delete(key);
      this.logger?.debug(`Removed credential "${providerId}"`);
    } catch (error) {
      this.logger?.warn(`Failed to remove credential "${providerId}":`, error);
    }
  }

  /**
   * Invalidate a credential (mark as invalid without removing)
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param scope - Credential scope
   * @param reason - Reason for invalidation
   * @param userId - User ID (required for user scope)
   */
  async invalidateCredential(
    sessionId: string,
    providerId: string,
    scope: CredentialScope,
    reason: string,
    userId?: string,
  ): Promise<void> {
    const key = this.credentialKey(sessionId, providerId, scope, userId);

    try {
      const appCredential = await this.read(key);
      if (!appCredential) return;
      await this.write(key, { ...appCredential, isValid: false, invalidReason: reason });
      this.logger?.debug(`Invalidated credential "${providerId}": ${reason}`);
    } catch (error) {
      this.logger?.warn(`Failed to invalidate credential "${providerId}":`, error);
    }
  }

  /**
   * Update OAuth credential tokens (for refresh)
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param scope - Credential scope
   * @param tokens - New tokens
   * @param userId - User ID (required for user scope)
   */
  async refreshOAuthCredential(
    sessionId: string,
    providerId: string,
    scope: CredentialScope,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
    userId?: string,
  ): Promise<void> {
    const key = this.credentialKey(sessionId, providerId, scope, userId);

    try {
      const appCredential = await this.read(key);
      if (!appCredential) return;
      const credential = appCredential.credential;
      if (credential.type !== 'oauth' && credential.type !== 'oauth_pkce') return;

      const refreshed: AppCredential = {
        ...appCredential,
        credential: {
          ...credential,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? credential.refreshToken,
          expiresAt: tokens.expiresAt ?? credential.expiresAt,
        },
        expiresAt: tokens.expiresAt ?? appCredential.expiresAt,
        isValid: true,
        invalidReason: undefined,
      };
      await this.write(key, refreshed);
      this.logger?.debug(`Refreshed OAuth credential "${providerId}"`);
    } catch (error) {
      this.logger?.warn(`Failed to refresh OAuth credential "${providerId}":`, error);
      throw error;
    }
  }

  /**
   * Get all credentials for a session
   *
   * @param sessionId - Current session ID
   * @param scope - Optional scope filter
   * @param userId - User ID (required for user scope)
   */
  async getAllCredentials(sessionId: string, scope?: CredentialScope, userId?: string): Promise<AppCredential[]> {
    if (scope) {
      return this.listCredentials(this.buildVaultKey(sessionId, scope, userId));
    }

    const scopes: CredentialScope[] = userId ? ['session', 'user', 'global'] : ['session', 'global'];
    const credentialsPerScope = await Promise.all(
      scopes.map((eachScope) => this.listCredentials(this.buildVaultKey(sessionId, eachScope, userId))),
    );
    return credentialsPerScope.flat();
  }

  private async listCredentials(vaultKey: string): Promise<AppCredential[]> {
    try {
      const keys = await this.credentials.keys(`${vaultKey}:*`);
      const records = await this.credentials.mget(keys);
      return records.flatMap((record, index) => (record?.storageKey === keys[index] ? [record.appCredential] : []));
    } catch {
      return [];
    }
  }

  private async read(key: string): Promise<AppCredential | null> {
    const record = await this.credentials.get(key);
    return record?.storageKey === key ? record.appCredential : null;
  }

  /** Writes until the credential expires, else for `cacheTtl` or `defaultCacheTtl`; an expired one is deleted. */
  private async write(key: string, appCredential: AppCredential, cacheTtl?: number): Promise<void> {
    const ttlMs =
      appCredential.expiresAt === undefined
        ? positiveOr(cacheTtl, this.defaultCacheTtl)
        : appCredential.expiresAt - Date.now();

    if (ttlMs <= 0) {
      await this.credentials.delete(key);
      return;
    }

    const ttlSeconds = Math.min(Math.ceil(ttlMs / 1000), MAX_TTL_SECONDS);
    await this.credentials.set(key, { storageKey: key, appCredential }, { ttlSeconds });
  }

  private credentialKey(sessionId: string, providerId: string, scope: CredentialScope, userId?: string): string {
    return `${this.buildVaultKey(sessionId, scope, userId)}:${providerId}`;
  }

  /**
   * Build vault key based on scope; user and session ids are hashed, so no id can reach into another's keys
   *
   * Key patterns:
   * - global: `authproviders:global`
   * - user: `authproviders:user:{sha256(userId)}`
   * - session: `authproviders:session:{sha256(sessionId)}`
   */
  private buildVaultKey(sessionId: string, scope: CredentialScope, userId?: string): string {
    switch (scope) {
      case 'global':
        return `${this.namespace}global`;
      case 'user':
        if (!userId) {
          throw new AuthInvalidInputError(
            `userId is required for user-scoped credentials (namespace: ${this.namespace})`,
          );
        }
        return `${this.namespace}user:${sha256Hex(userId)}`;
      case 'session':
        return `${this.namespace}session:${sha256Hex(sessionId)}`;
      default: {
        // Exhaustive check - will cause compile error if new scope is added
        const _exhaustive: never = scope;
        throw new AuthInvalidInputError(`Unknown credential scope: ${_exhaustive}`);
      }
    }
  }
}

/**
 * DI Token for AuthProvidersVault
 */
export const AUTH_PROVIDERS_VAULT = Symbol.for('frontmcp:AUTH_PROVIDERS_VAULT') as Token<AuthProvidersVault>;
