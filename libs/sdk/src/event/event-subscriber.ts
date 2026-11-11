import type { AuthoritiesContextBuilder } from '@frontmcp/auth';
import { type AuthInfo } from '@frontmcp/protocol';

import { type EventSubscriber } from '../common';
import { resolvePrincipal } from '../common/utils/principal.utils';
import { principalKeyOf } from '../elicitation/questions/question-subject';

/** Who owns a subscription: the key its identity is derived from, and the caller as the server knows them now. */
export interface EventSubscriberIdentity {
  /** `principal:<iss>#<sub>`, or `principal:<sub>` when the token names no issuer. */
  principalKey: string;
  subscriber: EventSubscriber;
}

/** The claim as a string, when it is a non-empty one. */
function stringClaim(claims: Record<string, unknown>, name: string): string | undefined {
  const value = claims[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The owner a signed-in caller's subscription gets; undefined for an anonymous caller, who cannot own one. */
export function eventSubscriberOf(
  authInfo: Partial<AuthInfo>,
  contextBuilder?: AuthoritiesContextBuilder,
): EventSubscriberIdentity | undefined {
  const principalKey = principalKeyOf(authInfo);
  if (!principalKey) return undefined;

  const plainAuthInfo = authInfo as Partial<Record<string, unknown>>;
  const tokenPrincipal = resolvePrincipal(plainAuthInfo);
  const principal = contextBuilder ? resolvePrincipal(plainAuthInfo, contextBuilder) : tokenPrincipal;
  const tenantId = contextBuilder?.build(plainAuthInfo as never).user.tenantId;
  const issuer = stringClaim(tokenPrincipal.claims, 'iss');

  return {
    principalKey,
    subscriber: {
      sub: principal.sub || tokenPrincipal.sub,
      ...(issuer && { iss: issuer }),
      ...(tenantId && { tenantId }),
      roles: principal.roles,
      permissions: principal.permissions,
      scopes: principal.scopes,
      claims: principal.claims,
    },
  };
}
