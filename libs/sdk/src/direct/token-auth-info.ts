import { isAnonymousSubject } from '@frontmcp/auth';

import { DirectPublicAuth } from '../auth/direct-public-auth';
import {
  authInfoFromAuthorization,
  normalizeEntryPrefix,
  normalizeScopeBase,
  type AuthorizationAuthInfo,
} from '../common';
import { PublicMcpError, SessionVerificationFailedError, UnauthorizedError } from '../errors';
import type { Scope } from '../scope/scope.instance';

/**
 * The caller `token` names, verified by `session:verify` as a Bearer token sent to `localhost`; empty when it names
 * none. A server without `auth` verifies no token (it has no session flows and no key), so its callers are anonymous.
 */
export async function authInfoForToken(scope: Scope, token: string): Promise<Partial<AuthorizationAuthInfo>> {
  if (scope.auth instanceof DirectPublicAuth) return {};
  const mcpPath = `${normalizeEntryPrefix(scope.entryPath)}${normalizeScopeBase(scope.routeBase)}` || '/';
  const request = {
    method: 'POST',
    path: mcpPath,
    url: mcpPath,
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
    query: {},
  };
  const verified = await scope.runFlow('session:verify', { request, sessionless: true });
  if (!verified) throw new SessionVerificationFailedError();
  if (verified.kind === 'unauthorized') {
    throw new UnauthorizedError("The server's auth did not accept the auth token", verified.prmMetadataHeader);
  }
  if (verified.kind === 'forbidden') {
    throw new PublicMcpError('The auth token lacks the scopes the server requires', 'INSUFFICIENT_SCOPE', 403);
  }
  if (isAnonymousSubject(verified.authorization.user.sub)) return {};
  return authInfoFromAuthorization(verified.authorization);
}
