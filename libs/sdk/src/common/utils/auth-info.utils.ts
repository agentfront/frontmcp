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
    /** The request's verified session: one the request presented and session verification accepted. */
    sessionId: string | undefined;
    sessionPayload: NonNullable<Authorization['session']>['payload'];
  };
}

/** Where a request carries the session it claims: its headers and query string. */
export interface SessionPresentingRequest {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/**
 * The session id a request itself carries: its `mcp-session-id` header, or the `?sessionId=` a legacy
 * SSE client posts its messages with (where session verification reads it too).
 *
 * @param request - The incoming HTTP request
 * @returns The id, or undefined when the request carries none
 */
export function sessionIdPresentedBy(request: SessionPresentingRequest): string | undefined {
  const header = request.headers?.['mcp-session-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const query = request.query?.['sessionId'];
  return typeof query === 'string' && query.length > 0 ? query : undefined;
}

/**
 * Project a verified authorization to its `AuthInfo`.
 *
 * `extra.sessionId` is what every cross-request rule reads as the request's verified session
 * (`FrontMcpContext.verifiedSessionId`, CONTEXT provider caching, elicitation ownership, Remember,
 * feature-flag targeting, guard partitions). So it holds the authorization's session only when that
 * is the session the request presented. In the anonymous and static modes, session verification
 * mints a new session for every request that presents none: a session transport hands that id to
 * the client (`initialize`, the SSE stream) and it identifies the client from the next request on,
 * but for this request, and on every request of a transport without sessions (MCP 2026-07-28, the
 * stateless transports), it identifies nothing beyond the one request.
 *
 * @param authorization - The authorization the auth stage verified
 * @param presentedSessionId - The session id the request presented (see {@link sessionIdPresentedBy});
 *   undefined when it presented none, or when its transport has no sessions
 * @returns The request's auth info
 */
export function authInfoFromAuthorization(
  authorization: Authorization,
  presentedSessionId?: string,
): AuthorizationAuthInfo {
  const { token, user, session } = authorization;
  const verifiedSession =
    session !== undefined && presentedSessionId !== undefined && session.id === presentedSessionId
      ? session
      : undefined;
  return {
    token,
    clientId: user?.sub,
    scopes: parseUserScopes(user as { scope?: unknown } | undefined),
    // JWT exp is in seconds; the SDK uses milliseconds throughout
    expiresAt: user?.exp ? user.exp * 1000 : undefined,
    user,
    extra: {
      user,
      sessionId: verifiedSession?.id,
      sessionPayload: verifiedSession?.payload,
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
