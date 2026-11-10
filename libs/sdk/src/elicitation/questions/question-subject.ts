import { isAnonymousSubject } from '@frontmcp/auth';
import { type AuthInfo } from '@frontmcp/protocol';

import { resolvePrincipal } from '../../common/utils/principal.utils';
import { resolveElicitationOwner } from '../helpers/fallback.helper';

/**
 * The key of a signed-in caller: `principal:<iss>#<sub>`, or `principal:<sub>` when its token names no issuer, so a
 * user of another issuer never shares it. Undefined for an anonymous caller.
 */
export function principalKeyOf(authInfo: Partial<AuthInfo> | undefined): string | undefined {
  const { sub, claims } = resolvePrincipal(authInfo as Partial<Record<string, unknown>> | undefined);
  if (isAnonymousSubject(sub)) return undefined;
  const issuer = typeof claims['iss'] === 'string' ? claims['iss'] : '';
  return issuer ? `principal:${issuer}#${sub}` : `principal:${sub}`;
}

/**
 * Who a persistent question belongs to: the caller's {@link principalKeyOf}, so a later session of the same user gets
 * the answer and a user of another issuer does not, else `session:<id>` for the session the server verified, else
 * nobody (undefined).
 */
export function questionSubjectOf(authInfo: Partial<AuthInfo> | undefined): string | undefined {
  const principalKey = principalKeyOf(authInfo);
  if (principalKey) return principalKey;
  const owner = resolveElicitationOwner({ authInfo });
  return owner?.startsWith('session:') ? owner : undefined;
}
