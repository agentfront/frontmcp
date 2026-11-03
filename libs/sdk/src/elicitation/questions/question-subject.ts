import { isAnonymousSubject } from '@frontmcp/auth';
import { type AuthInfo } from '@frontmcp/protocol';

import { resolvePrincipal } from '../../common/utils/principal.utils';
import { resolveElicitationOwner } from '../helpers/fallback.helper';

/**
 * Who a persistent question belongs to: `principal:<iss>#<sub>` for a signed-in caller (`principal:<sub>` when its token
 * names no issuer), so a later session of the same user gets the answer and a user of another issuer does not, else
 * `session:<id>` for the session the server verified, else nobody (undefined).
 */
export function questionSubjectOf(authInfo: Partial<AuthInfo> | undefined): string | undefined {
  const { sub, claims } = resolvePrincipal(authInfo as Partial<Record<string, unknown>> | undefined);
  const issuer = typeof claims['iss'] === 'string' ? claims['iss'] : '';
  if (!isAnonymousSubject(sub)) return issuer ? `principal:${issuer}#${sub}` : `principal:${sub}`;
  const owner = resolveElicitationOwner({ authInfo });
  return owner?.startsWith('session:') ? owner : undefined;
}
