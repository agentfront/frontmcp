/**
 * AuthProvidersVault - Dedicated storage namespace for auth provider credentials
 *
 * Uses the same underlying storage (Redis/Vercel KV) as AuthorizationVault
 * but with a separate namespace to avoid conflicts.
 */

import { Token } from '@frontmcp/di';
import type { Credential, AuthorizationVault, AppCredential } from '../session';
import type { CredentialScope } from './auth-providers.types';
import { extractCredentialExpiry } from './credential-helpers';
import type { AuthLogger } from '../common/auth-logger.interface';
import { AuthInvalidInputError, CredentialStorageError } from '../errors/auth-internal.errors';

/**
 * AuthProvidersVault - Storage layer for auth provider credentials
 */
export class AuthProvidersVault {
  constructor(
    private readonly baseVault: AuthorizationVault,
    private readonly namespace = 'authproviders:',
    private readonly logger?: AuthLogger,
  ) {}

  /**
   * Store a credential in the vault
   *
   * @param sessionId - Current session ID
   * @param providerId - Provider name
   * @param credential - Credential to store
   * @param scope - Credential scope
   * @param userId - User ID (required for user scope)
   */
  async storeCredential<T extends Credential>(
    sessionId: string,
    providerId: string,
    credential: T,
    scope: CredentialScope,
    userId?: string,
  ): Promise<void> {
    const vaultKey = this.buildVaultKey(sessionId, scope, userId);

    const appCredential: AppCredential = {
      appId: this.namespace,
      providerId,
      credential,
      acquiredAt: Date.now(),
      isValid: true,
      expiresAt: extractCredentialExpiry(credential),
    };

    try {
      await this.baseVault.addAppCredential(vaultKey, appCredential);
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
    const vaultKey = this.buildVaultKey(sessionId, scope, userId);

    try {
      const appCredential = await this.baseVault.getCredential(vaultKey, this.namespace, providerId);

      if (!appCredential) {
        return null;
      }

      // Check if credential is still valid
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
    const vaultKey = this.buildVaultKey(sessionId, scope, userId);

    try {
      await this.baseVault.removeAppCredential(vaultKey, this.namespace, providerId);
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
    const vaultKey = this.buildVaultKey(sessionId, scope, userId);

    try {
      await this.baseVault.invalidateCredential(vaultKey, this.namespace, providerId, reason);
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
    const vaultKey = this.buildVaultKey(sessionId, scope, userId);

    try {
      await this.baseVault.refreshOAuthCredential(vaultKey, this.namespace, providerId, tokens);
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
    // Get credentials for the specific scope
    if (scope) {
      const vaultKey = this.buildVaultKey(sessionId, scope, userId);
      try {
        return await this.baseVault.getAppCredentials(vaultKey, this.namespace);
      } catch {
        return [];
      }
    }

    // Get credentials from all scopes
    const credentials: AppCredential[] = [];

    // Session scope
    try {
      const sessionCreds = await this.baseVault.getAppCredentials(
        this.buildVaultKey(sessionId, 'session'),
        this.namespace,
      );
      credentials.push(...sessionCreds);
    } catch {
      // Ignore
    }

    // User scope (if userId provided)
    if (userId) {
      try {
        const userCreds = await this.baseVault.getAppCredentials(
          this.buildVaultKey(sessionId, 'user', userId),
          this.namespace,
        );
        credentials.push(...userCreds);
      } catch {
        // Ignore
      }
    }

    // Global scope
    try {
      const globalCreds = await this.baseVault.getAppCredentials(
        this.buildVaultKey(sessionId, 'global'),
        this.namespace,
      );
      credentials.push(...globalCreds);
    } catch {
      // Ignore
    }

    return credentials;
  }

  /**
   * Build vault key based on scope
   *
   * Key patterns:
   * - global: `authproviders:global`
   * - user: `authproviders:user:{userId}`
   * - session: `authproviders:session:{sessionId}`
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
        return `${this.namespace}user:${userId}`;
      case 'session':
        return `${this.namespace}session:${sessionId}`;
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
