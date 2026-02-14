// auth/authorization/orchestrated.authorization.ts

import { AuthorizationBase } from './authorization.class';
import type { AuthorizationCreateCtx, AuthUser, AuthMode } from './authorization.types';
import type { ProviderSnapshot } from '../session/session.types';
import type { EncryptedBlob } from '@frontmcp/utils';
import { deriveAuthorizationId } from '../utils/authorization-id.utils';
import { NoProviderIdError, TokenStoreRequiredError, TokenNotAvailableError } from '../errors/auth-internal.errors';

/**
 * Token store interface for orchestrated mode
 * Implementations can be memory-based, Redis, or custom stores
 */
export interface TokenStore {
  /**
   * Retrieve decrypted access token for a provider
   */
  getAccessToken(authorizationId: string, providerId: string): Promise<string | null>;

  /**
   * Retrieve decrypted refresh token for a provider
   */
  getRefreshToken(authorizationId: string, providerId: string): Promise<string | null>;

  /**
   * Store tokens for a provider (encrypted)
   */
  storeTokens(
    authorizationId: string,
    providerId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    },
  ): Promise<void>;

  /**
   * Delete tokens for a provider
   */
  deleteTokens(authorizationId: string, providerId: string): Promise<void>;

  /**
   * Check if tokens exist for a provider
   */
  hasTokens(authorizationId: string, providerId: string): Promise<boolean>;

  /**
   * Get all provider IDs that have tokens stored for this authorization.
   */
  getProviderIds(authorizationId: string): Promise<string[]>;

  /**
   * Migrate tokens from one authorization ID to another.
   * Used when tokens are stored with a pending ID during federated auth
   * and need to be accessible under the real authorization ID.
   *
   * @param fromAuthId - Source authorization ID (e.g., "pending:abc123")
   * @param toAuthId - Target authorization ID (e.g., "def456")
   */
  migrateTokens(fromAuthId: string, toAuthId: string): Promise<void>;
}

/**
 * Token refresh callback type
 */
export type TokenRefreshCallback = (
  providerId: string,
  refreshToken: string,
) => Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}>;

/**
 * Provider token state for orchestrated authorization
 */
export interface OrchestratedProviderState {
  /** Provider ID */
  id: string;
  /** Encrypted access token blob */
  accessTokenEnc?: EncryptedBlob;
  /** Encrypted refresh token blob */
  refreshTokenEnc?: EncryptedBlob;
  /** Token expiration (epoch ms) */
  expiresAt?: number;
  /** External reference ID (for vault/store) */
  secretRefId?: string;
  /** Refresh reference ID */
  refreshRefId?: string;
}

/**
 * Context for creating an OrchestratedAuthorization
 */
export interface OrchestratedAuthorizationCreateCtx {
  /**
   * The local JWT issued by the orchestrating server
   */
  token: string;

  /**
   * User identity from upstream provider
   */
  user: AuthUser;

  /**
   * Scopes granted to this authorization
   */
  scopes?: string[];

  /**
   * JWT claims
   */
  claims?: Record<string, unknown>;

  /**
   * Expiration (epoch ms)
   */
  expiresAt?: number;

  /**
   * Primary provider ID (default for getToken)
   */
  primaryProviderId?: string;

  /**
   * Token store for retrieving/storing provider tokens
   */
  tokenStore?: TokenStore;

  /**
   * Token refresh callback
   */
  onTokenRefresh?: TokenRefreshCallback;

  /**
   * Provider states (with encrypted tokens)
   */
  providers?: Record<string, OrchestratedProviderState>;

  /**
   * Precomputed authorization projections
   */
  authorizedTools?: AuthorizationCreateCtx['authorizedTools'];
  authorizedToolIds?: string[];
  authorizedPrompts?: AuthorizationCreateCtx['authorizedPrompts'];
  authorizedPromptIds?: string[];
  authorizedApps?: AuthorizationCreateCtx['authorizedApps'];
  authorizedAppIds?: string[];
  authorizedResources?: string[];
  /**
   * Provider IDs that the user has explicitly authorized during federated login.
   * Populated from JWT claims (`federated.selectedProviders`) or token store.
   * Controls which providers the authorization has access to for progressive auth.
   */
  authorizedProviderIds?: string[];
}

/**
 * OrchestratedAuthorization - Local auth server with secure token storage
 *
 * In orchestrated mode:
 * - The MCP server acts as an OAuth client to upstream providers
 * - Provider tokens are encrypted and never exposed to the LLM
 * - Supports token refresh and multi-provider scenarios
 * - getToken() retrieves decrypted tokens from secure storage
 * - Ideal for multi-tenant, federated auth, or high-security scenarios
 */
export class OrchestratedAuthorization extends AuthorizationBase {
  readonly mode: AuthMode = 'orchestrated';

  /**
   * Primary provider ID (default for getToken)
   */
  readonly primaryProviderId?: string;

  /**
   * Token store for secure token retrieval
   */
  readonly #tokenStore?: TokenStore;

  /**
   * Token refresh callback
   */
  readonly #onTokenRefresh?: TokenRefreshCallback;

  /**
   * Provider states (encrypted tokens)
   */
  readonly #providerStates: Map<string, OrchestratedProviderState>;

  private constructor(
    ctx: AuthorizationCreateCtx & {
      primaryProviderId?: string;
      tokenStore?: TokenStore;
      onTokenRefresh?: TokenRefreshCallback;
      providerStates?: Map<string, OrchestratedProviderState>;
    },
  ) {
    super(ctx);
    this.primaryProviderId = ctx.primaryProviderId;
    this.#tokenStore = ctx.tokenStore;
    this.#onTokenRefresh = ctx.onTokenRefresh;
    this.#providerStates = ctx.providerStates ?? new Map();
  }

  /**
   * Create an OrchestratedAuthorization
   *
   * @param ctx - Creation context
   * @returns A new OrchestratedAuthorization instance
   *
   * @example
   * ```typescript
   * const auth = OrchestratedAuthorization.create({
   *   token: localJwt,
   *   user: { sub: 'user123', name: 'John' },
   *   primaryProviderId: 'github',
   *   tokenStore: redisTokenStore,
   *   providers: {
   *     github: { id: 'github', secretRefId: 'vault:github:user123' },
   *   },
   * });
   *
   * // Retrieve token securely (never exposed to LLM)
   * const githubToken = await auth.getToken('github');
   * ```
   */
  static create(ctx: OrchestratedAuthorizationCreateCtx): OrchestratedAuthorization {
    const {
      token,
      user,
      scopes = [],
      claims,
      expiresAt,
      primaryProviderId,
      tokenStore,
      onTokenRefresh,
      providers = {},
      authorizedProviderIds,
      ...projections
    } = ctx;

    // Generate authorization ID from token
    const id = deriveAuthorizationId(token);

    // Build provider states map
    const providerStates = new Map<string, OrchestratedProviderState>();
    const authorizedProviders: Record<string, ProviderSnapshot> = {};
    const providerIdsFromState: string[] = [];

    for (const [providerId, state] of Object.entries(providers)) {
      providerStates.set(providerId, state);
      providerIdsFromState.push(providerId);

      // Create snapshot without exposing tokens
      authorizedProviders[providerId] = {
        id: providerId,
        exp: state.expiresAt,
        embedMode: state.secretRefId ? 'ref' : 'store-only',
        secretRefId: state.secretRefId,
        refreshRefId: state.refreshRefId,
      };
    }

    // Use explicitly provided authorizedProviderIds, or derive from provider states
    const finalAuthorizedProviderIds =
      authorizedProviderIds ?? (providerIdsFromState.length > 0 ? providerIdsFromState : undefined);

    return new OrchestratedAuthorization({
      id,
      isAnonymous: false,
      user,
      claims,
      expiresAt,
      scopes,
      token,
      primaryProviderId,
      tokenStore,
      onTokenRefresh,
      providerStates,
      authorizedProviders,
      ...projections,
      authorizedProviderIds: finalAuthorizedProviderIds,
    });
  }

  /**
   * Get access token for a provider
   *
   * Retrieves the decrypted token from the secure store.
   * If the token is expired and refresh is available, attempts refresh.
   *
   * @param providerId - Provider ID (defaults to primaryProviderId)
   * @returns The decrypted access token
   * @throws If no token store or no token available
   */
  async getToken(providerId?: string): Promise<string> {
    const targetProviderId = providerId ?? this.primaryProviderId;

    if (!targetProviderId) {
      throw new NoProviderIdError('OrchestratedAuthorization: No provider ID specified and no primary provider set');
    }

    if (!this.#tokenStore) {
      throw new TokenStoreRequiredError('orchestrated token retrieval');
    }

    // Check if token exists
    const hasToken = await this.#tokenStore.hasTokens(this.id, targetProviderId);
    if (!hasToken) {
      throw new TokenNotAvailableError(
        `OrchestratedAuthorization: No tokens available for provider "${targetProviderId}"`,
      );
    }

    // Get access token
    const accessToken = await this.#tokenStore.getAccessToken(this.id, targetProviderId);

    if (accessToken) {
      // Check if token needs refresh
      const providerState = this.#providerStates.get(targetProviderId);
      if (providerState?.expiresAt && providerState.expiresAt < Date.now()) {
        return this.refreshAndGetToken(targetProviderId);
      }
      return accessToken;
    }

    // Try to refresh if we have a refresh token
    return this.refreshAndGetToken(targetProviderId);
  }

  /**
   * Refresh token and return new access token
   */
  private async refreshAndGetToken(providerId: string): Promise<string> {
    if (!this.#tokenStore || !this.#onTokenRefresh) {
      throw new TokenNotAvailableError(
        `OrchestratedAuthorization: Token expired for provider "${providerId}" and refresh not available`,
      );
    }

    const refreshToken = await this.#tokenStore.getRefreshToken(this.id, providerId);
    if (!refreshToken) {
      throw new TokenNotAvailableError(
        `OrchestratedAuthorization: No refresh token available for provider "${providerId}"`,
      );
    }

    // Perform refresh
    const result = await this.#onTokenRefresh(providerId, refreshToken);

    // Store new tokens
    await this.#tokenStore.storeTokens(this.id, providerId, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined,
    });

    // Update provider state
    const currentState = this.#providerStates.get(providerId);
    if (currentState) {
      currentState.expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
    }

    return result.accessToken;
  }

  /**
   * Check if a provider has tokens stored
   */
  hasProvider(providerId: string): boolean {
    return this.#providerStates.has(providerId);
  }

  /**
   * Get all provider IDs with tokens
   */
  getProviderIds(): string[] {
    return Array.from(this.#providerStates.keys());
  }

  /**
   * Add a new provider to this authorization
   * Used when user authorizes additional providers after initial auth
   */
  async addProvider(
    providerId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    },
  ): Promise<void> {
    if (!this.#tokenStore) {
      throw new TokenStoreRequiredError('adding providers');
    }

    const expiresAt = tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined;

    // Store tokens
    await this.#tokenStore.storeTokens(this.id, providerId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
    });

    // Update internal state
    this.#providerStates.set(providerId, {
      id: providerId,
      expiresAt,
      secretRefId: `${this.id}:${providerId}`,
    });

    // Note: authorizedProviders/authorizedProviderIds are readonly
    // The caller should create a new authorization if these need to be updated
  }

  // ============================================
  // Progressive/Incremental Authorization
  // ============================================

  /**
   * Mutable app authorization state for progressive auth.
   * This allows expanding authorization without reissuing the session token.
   */
  #mutableAuthorizedApps: Map<string, { id: string; toolIds: string[] }> = new Map(
    Object.entries(this.authorizedApps ?? {}),
  );

  /**
   * Add app authorization after initial auth (progressive authorization).
   * Stores app tokens server-side and updates authorized apps without JWT reissue.
   *
   * @param appId - App ID to authorize
   * @param toolIds - Tool IDs accessible through this app authorization
   * @param tokens - OAuth tokens from the app's auth provider
   *
   * @example
   * ```typescript
   * // User clicks auth link for Slack app
   * await auth.addAppAuthorization('slack', ['slack:send_message', 'slack:list_channels'], {
   *   accessToken: slackAccessToken,
   *   refreshToken: slackRefreshToken,
   *   expiresIn: 3600,
   * });
   *
   * // Now slack tools will work without re-auth
   * ```
   */
  async addAppAuthorization(
    appId: string,
    toolIds: string[],
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    },
  ): Promise<void> {
    if (!this.#tokenStore) {
      throw new TokenStoreRequiredError('progressive authorization');
    }

    // Use app ID as provider ID for app-specific token storage
    const providerId = `app:${appId}`;

    // Store tokens server-side (SECURITY: never expose in JWT)
    await this.addProvider(providerId, tokens);

    // Track app authorization in mutable state
    this.#mutableAuthorizedApps.set(appId, { id: appId, toolIds });
  }

  /**
   * Get access token for a specific app (for tool execution).
   * Retrieves the app's OAuth token from server-side storage.
   *
   * @param appId - App ID to get token for
   * @returns The decrypted access token, or null if not authorized
   */
  async getAppToken(appId: string): Promise<string | null> {
    if (!this.#mutableAuthorizedApps.has(appId)) {
      return null;
    }

    const providerId = `app:${appId}`;

    try {
      return await this.getToken(providerId);
    } catch {
      return null;
    }
  }

  /**
   * Check if an app is authorized (includes progressively authorized apps).
   * Overrides base class to include mutable app authorization state.
   */
  override isAppAuthorized(appId: string): boolean {
    return this.#mutableAuthorizedApps.has(appId) || super.isAppAuthorized(appId);
  }

  /**
   * Get all authorized app IDs (includes progressively authorized apps).
   */
  getAllAuthorizedAppIds(): string[] {
    const baseIds = new Set(this.authorizedAppIds ?? []);
    for (const appId of this.#mutableAuthorizedApps.keys()) {
      baseIds.add(appId);
    }
    return Array.from(baseIds);
  }

  /**
   * Get tool IDs authorized through an app.
   */
  getAppToolIds(appId: string): string[] | undefined {
    return this.#mutableAuthorizedApps.get(appId)?.toolIds ?? this.authorizedApps?.[appId]?.toolIds;
  }

  /**
   * Remove a provider from this authorization
   */
  async removeProvider(providerId: string): Promise<void> {
    if (this.#tokenStore) {
      await this.#tokenStore.deleteTokens(this.id, providerId);
    }
    this.#providerStates.delete(providerId);
  }

  /**
   * Get the issuer (local orchestrator)
   */
  get issuer(): string | undefined {
    return this.claims?.['iss'] as string | undefined;
  }
}
