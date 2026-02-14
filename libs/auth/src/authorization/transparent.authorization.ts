// auth/authorization/transparent.authorization.ts

import { sha256Hex } from '@frontmcp/utils';
import { AuthorizationBase } from './authorization.class';
import type { AuthorizationCreateCtx, AuthUser, AuthMode } from './authorization.types';
import type { ProviderSnapshot } from '../session/session.types';
import { TokenNotAvailableError } from '../errors/auth-internal.errors';

/**
 * Verified JWT payload from transparent auth provider
 */
export interface TransparentVerifiedPayload {
  /** Subject identifier */
  sub: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration (seconds since epoch) */
  exp?: number;
  /** Issued at (seconds since epoch) */
  iat?: number;
  /** Scopes (space-separated or array) */
  scope?: string | string[];
  /** Display name */
  name?: string;
  /** Email */
  email?: string;
  /** Picture URL */
  picture?: string;
  /** Additional claims */
  [key: string]: unknown;
}

/**
 * Context for creating a TransparentAuthorization
 */
export interface TransparentAuthorizationCreateCtx {
  /**
   * The original bearer token (passed through to downstream)
   */
  token: string;

  /**
   * Verified JWT payload from the upstream provider
   */
  payload: TransparentVerifiedPayload;

  /**
   * Provider ID for this authorization
   */
  providerId: string;

  /**
   * Provider name for display/logging
   */
  providerName?: string;

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
}

/**
 * TransparentAuthorization - Pass-through OAuth tokens
 *
 * In transparent mode:
 * - The client's token is forwarded directly to downstream services
 * - Token validation happens via the upstream provider's JWKS
 * - getToken() returns the original bearer token
 * - Ideal when the auth server is the source of truth
 */
export class TransparentAuthorization extends AuthorizationBase {
  readonly mode: AuthMode = 'transparent';

  /**
   * Provider ID that issued the token
   */
  readonly providerId: string;

  /**
   * Provider display name
   */
  readonly providerName?: string;

  private constructor(
    ctx: AuthorizationCreateCtx & {
      providerId: string;
      providerName?: string;
    },
  ) {
    super(ctx);
    this.providerId = ctx.providerId;
    this.providerName = ctx.providerName;
  }

  /**
   * Create a TransparentAuthorization from a verified JWT
   *
   * @param ctx - Creation context with token and verified payload
   * @returns A new TransparentAuthorization instance
   *
   * @example
   * ```typescript
   * const auth = TransparentAuthorization.fromVerifiedToken({
   *   token: bearerToken,
   *   payload: verifiedClaims,
   *   providerId: 'auth0',
   * });
   *
   * // Pass token through to downstream
   * const token = await auth.getToken();
   * ```
   */
  static fromVerifiedToken(ctx: TransparentAuthorizationCreateCtx): TransparentAuthorization {
    const { token, payload, providerId, providerName, ...projections } = ctx;

    // Extract user identity from payload
    const user: AuthUser = {
      sub: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      anonymous: false,
    };

    // Parse scopes from payload
    const scopes = TransparentAuthorization.parseScopes(payload.scope);

    // Calculate expiration from JWT exp claim
    const expiresAt = payload.exp ? payload.exp * 1000 : undefined;

    // Generate authorization ID from token signature fingerprint
    const id = TransparentAuthorization.generateAuthorizationId(token);

    // Create provider snapshot for this authorization
    const providerSnapshot: ProviderSnapshot = {
      id: providerId,
      exp: expiresAt,
      payload: payload as Record<string, unknown>,
      embedMode: 'plain', // transparent mode keeps token in memory
      token, // the original token
    };

    return new TransparentAuthorization({
      id,
      isAnonymous: false,
      user,
      claims: payload as Record<string, unknown>,
      expiresAt,
      scopes,
      token,
      providerId,
      providerName,
      authorizedProviders: { [providerId]: providerSnapshot },
      authorizedProviderIds: [providerId],
      ...projections,
    });
  }

  /**
   * Get the original bearer token for pass-through
   *
   * In transparent mode, the same token is returned regardless of providerId
   * since only one provider (the upstream) issued the token.
   *
   * @param _providerId - Ignored in transparent mode
   * @returns The original bearer token
   */
  async getToken(_providerId?: string): Promise<string> {
    if (!this.token) {
      throw new TokenNotAvailableError('TransparentAuthorization: Token not available');
    }
    return this.token;
  }

  /**
   * Parse scope claim from JWT payload
   */
  private static parseScopes(scope: string | string[] | undefined): string[] {
    if (!scope) return [];
    if (Array.isArray(scope)) return scope;
    return scope.split(/\s+/).filter(Boolean);
  }

  /**
   * Generate authorization ID from token signature
   * Uses SHA-256 fingerprint of the token signature for uniqueness
   */
  private static generateAuthorizationId(token: string): string {
    const parts = token.split('.');
    const signature = parts[2] || token;
    return sha256Hex(signature).substring(0, 16);
  }

  /**
   * Get the issuer from the token claims
   */
  get issuer(): string | undefined {
    return this.claims?.['iss'] as string | undefined;
  }

  /**
   * Get the audience from the token claims
   */
  get audience(): string | string[] | undefined {
    return this.claims?.['aud'] as string | string[] | undefined;
  }

  /**
   * Check if the token was issued for a specific audience
   */
  hasAudience(aud: string): boolean {
    const tokenAud = this.audience;
    if (!tokenAud) return false;
    if (Array.isArray(tokenAud)) return tokenAud.includes(aud);
    return tokenAud === aud;
  }
}
