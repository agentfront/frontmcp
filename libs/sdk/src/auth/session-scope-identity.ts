/**
 * Who session-scoped storage of a request belongs to.
 */

import { isAnonymousSubject } from '@frontmcp/auth';

import { type FrontMcpContext } from '../context/frontmcp-context';

/**
 * The identity that keys session-scoped storage (secure-store secrets, auth-provider credentials)
 * for the current request: the session the server verified (`FrontMcpContext.verifiedSessionId`),
 * else `principal:<sub>` for a signed-in caller, so its storage lasts across its requests.
 *
 * Never `FrontMcpContext.sessionId` itself: under MCP 2026-07-28 and on the stateless transports it
 * is whatever `mcp-session-id` the client sent, so a caller who sent another caller's id reached
 * that caller's storage. The `principal:` form never matches a session id the server mints
 * (`iv.tag.data`, no `:`).
 *
 * @returns The identity, or undefined for an anonymous caller without a verified session
 */
export function sessionScopeIdentity(ctx: FrontMcpContext): string | undefined {
  const verified = ctx.verifiedSessionId;
  if (verified) return verified;
  const authInfo = ctx.authInfo ?? {};
  const extraUser = authInfo.extra?.['user'] as { sub?: unknown } | undefined;
  const principal = [authInfo.user?.sub, extraUser?.sub, authInfo.clientId].find(
    (candidate): candidate is string => !isAnonymousSubject(candidate),
  );
  return principal ? `principal:${principal}` : undefined;
}
