import { isAnonymousSubject } from '@frontmcp/auth';
import { type AuthInfo } from '@frontmcp/protocol';

import { resolvePrincipal } from '../../common/utils/principal.utils';
import { resolveElicitationOwner } from '../helpers/fallback.helper';

/**
 * Who a persistent question belongs to: `principal:<sub>` for a signed-in caller, so a later session of the same user
 * gets the answer, else `session:<id>` for the session the server verified, else nobody (undefined).
 */
export function questionSubjectOf(authInfo: Partial<AuthInfo> | undefined): string | undefined {
  const { sub } = resolvePrincipal(authInfo as Partial<Record<string, unknown>> | undefined);
  if (!isAnonymousSubject(sub)) return `principal:${sub}`;
  const owner = resolveElicitationOwner({ authInfo });
  return owner?.startsWith('session:') ? owner : undefined;
}
