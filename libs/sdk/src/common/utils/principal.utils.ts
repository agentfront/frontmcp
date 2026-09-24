import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

/**
 * The caller identity a permission check evaluates against.
 *
 * Deliberately flat: every consumer needs the same four things, and resolving
 * them in one place stops each call site from inventing its own claim lookup.
 */
export interface ResolvedPrincipal {
  /** Subject identifier, or '' when the caller is anonymous. */
  sub: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  claims: Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.length > 0) return value.split(' ').filter(Boolean);
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * Convert the first source that is actually PRESENT, rather than the first that
 * happens to be non-empty.
 *
 * The difference matters for authorization: an explicitly empty array is a
 * statement ("no scopes"), not a gap to fill from somewhere weaker.
 */
function firstPresent(sources: unknown[], convert: (value: unknown) => string[]): string[] {
  for (const source of sources) {
    if (source !== undefined && source !== null) return convert(source);
  }
  return [];
}

/**
 * Resolve the caller's roles, permissions, scopes and claims from AuthInfo.
 *
 * When the scope has an authorities engine configured, its `claimsMapping` /
 * `claimsResolver` is authoritative — a server that told FrontMCP where its
 * roles live must not have a permission check quietly look somewhere else.
 * Without one, the same fallback chain the authorities builder uses applies, so
 * both paths agree on what "has the admin role" means.
 *
 * Scopes are read from AuthInfo directly (the verified token's scope set) and,
 * as a fallback, from a `scope`/`scopes` claim.
 */
export function resolvePrincipal(
  authInfo: Partial<Record<string, unknown>> | undefined,
  contextBuilder?: AuthoritiesContextBuilder,
): ResolvedPrincipal {
  const info = authInfo ?? {};
  const user = asRecord(info['user']) ?? {};
  const extraAuthorization = asRecord(asRecord(info['extra'])?.['authorization']);
  const authInfoClaims = asRecord(info['claims']) ?? {};
  const authorizationClaims = asRecord(extraAuthorization?.['claims']) ?? {};
  const claims: Record<string, unknown> = { ...authorizationClaims, ...authInfoClaims, ...user };

  // `AuthInfo.scopes` is REQUIRED by the protocol type, so it is always present
  // and an empty array there carries no intent — a session-reconstructed
  // authorization legitimately has none while the verified token still states
  // its scope. Fall through on empty for that first source only; the remaining
  // sources are optional, so presence is meaningful for them.
  //
  // Falling through does not weaken the check: every source below is derived
  // from the same verified token.
  const scopes = toStringArray(info['scopes']).length
    ? toStringArray(info['scopes'])
    : firstPresent([extraAuthorization?.['scopes'], claims['scope'], claims['scopes']], toStringArray);

  if (contextBuilder) {
    const ctx = contextBuilder.build(info as never);
    return {
      sub: ctx.user.sub ?? '',
      roles: ctx.user.roles,
      permissions: ctx.user.permissions,
      scopes,
      claims: ctx.user.claims,
    };
  }

  // Fallback chain mirrors AuthoritiesContextBuilder.build():
  // user.roles → claims.roles → the authorization's scopes. Presence-based for
  // the same reason as scopes above, and so both paths agree on what an
  // explicitly empty array means.
  const roles = firstPresent([user['roles'], claims['roles'], extraAuthorization?.['scopes']], toStringArray);

  const permissions = firstPresent([user['permissions'], claims['permissions']], toStringArray);

  return {
    sub: typeof user['sub'] === 'string' ? (user['sub'] as string) : '',
    roles,
    permissions,
    scopes,
    claims,
  };
}
