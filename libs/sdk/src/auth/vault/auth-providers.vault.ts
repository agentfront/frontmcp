/**
 * AuthProvidersVault - Dedicated storage namespace for auth provider credentials
 *
 * Uses the same underlying storage (Redis/Vercel KV) as AuthorizationVault
 * but with a separate namespace to avoid conflicts.
 */

import { Token } from '@frontmcp/di';
import type { Credential, AuthorizationVault, AppCredential } from '../session/authorization-vault';
import type { CredentialScope } from './auth-providers.types';
import { FrontMcpLogger } from '../../common';

/**
 * AuthProvidersVault - Storage layer for auth provider credentials
 */
export class AuthProvidersVault {
  private readonly logger?: FrontMcpLogger;

  constructor(
    private readonly baseVault: AuthorizationVault,
    private readonly namespace = 'authproviders:',
    logger?: FrontMcpLogger,
  ) {
    this.logger = logger?.child('AuthProvidersVault');
  }

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
      expiresAt: this.extractExpiry(credential),
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
      return null;
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
          throw new Error(`userId is required for user-scoped credentials (namespace: ${this.namespace})`);
        }
        return `${this.namespace}user:${userId}`;
      case 'session':
        return `${this.namespace}session:${sessionId}`;
      default:
        return `${this.namespace}session:${sessionId}`;
    }
  }

  /**
   * Extract expiry time from credential
   */
  private extractExpiry(credential: Credential): number | undefined {
    switch (credential.type) {
      case 'oauth':
      case 'oauth_pkce':
      case 'bearer':
      case 'service_account':
        return credential.expiresAt;
      default:
        return undefined;
    }
  }
}

/**
 * DI Token for AuthProvidersVault
 */
export const AUTH_PROVIDERS_VAULT = Symbol.for('frontmcp:AUTH_PROVIDERS_VAULT') as Token<AuthProvidersVault>;
