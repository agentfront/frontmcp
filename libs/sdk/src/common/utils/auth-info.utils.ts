import type { Authorization } from '../types/auth/session.types';

/**
 * The MCP `AuthInfo` shape every entry point hands to handlers and tools for a
 * verified authorization: claims under top-level `user` (read by `this.auth` and
 * authorities) and under `extra.user`, and the token's granted `scopes`.
 */
export interface AuthorizationAuthInfo {
  token: string;
  clientId: string | undefined;
  scopes: string[];
  expiresAt: number | undefined;
  user: Authorization['user'];
  extra: {
    user: Authorization['user'];
    sessionId: string | undefined;
    sessionPayload: NonNullable<Authorization['session']>['payload'];
  };
}

/**
 * Project a verified authorization to its `AuthInfo`.
 *
 * @param authorization - The authorization the auth stage verified
 * @returns The request's auth info
 */
export function authInfoFromAuthorization(authorization: Authorization): AuthorizationAuthInfo {
  const { token, user, session } = authorization;
  return {
    token,
    clientId: user?.sub,
    scopes: parseUserScopes(user as { scope?: unknown } | undefined),
    // JWT exp is in seconds; the SDK uses milliseconds throughout
    expiresAt: user?.exp ? user.exp * 1000 : undefined,
    user,
    extra: {
      user,
      sessionId: session?.id,
      sessionPayload: session?.payload,
    },
  };
}

/**
 * Parse a verified user claim's space-delimited `scope` (RFC 6749 §3.3) into a scopes array.
 */
function parseUserScopes(user: { scope?: unknown } | undefined): string[] {
  const scope = user?.scope;
  return typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : [];
}
