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

  const scopes = (() => {
    const direct = toStringArray(info['scopes']);
    if (direct.length > 0) return direct;
    const fromAuthorization = toStringArray(extraAuthorization?.['scopes']);
    if (fromAuthorization.length > 0) return fromAuthorization;
    return toStringArray(claims['scope'] ?? claims['scopes']);
  })();

  if (contextBuilder) {
    const ctx = contextBuilder.build(info as never);
    return {
      sub: ctx.user.sub,
      roles: ctx.user.roles,
      permissions: ctx.user.permissions,
      scopes,
      claims: ctx.user.claims,
    };
  }

  // Fallback chain mirrors AuthoritiesContextBuilder.build():
  // user.roles → claims.roles → the authorization's scopes.
  const roles = (() => {
    const fromUser = toStringArray(user['roles']);
    if (fromUser.length > 0) return fromUser;
    const fromClaims = toStringArray(claims['roles']);
    if (fromClaims.length > 0) return fromClaims;
    return toStringArray(extraAuthorization?.['scopes']);
  })();

  const permissions = (() => {
    const fromUser = toStringArray(user['permissions']);
    return fromUser.length > 0 ? fromUser : toStringArray(claims['permissions']);
  })();

  return {
    sub: typeof user['sub'] === 'string' ? (user['sub'] as string) : '',
    roles,
    permissions,
    scopes,
    claims,
  };
}
