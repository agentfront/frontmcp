/**
 * Authorities Evaluation Context Builder
 *
 * Builds an AuthoritiesEvaluationContext from AuthInfo and claimsMapping.
 * Handles JWT shape differences across IdPs (Auth0, Keycloak, Okta, etc.).
 */

import type { AuthoritiesEvaluationContext, RelationshipResolver } from './authorities.types';
import type { AuthoritiesClaimsMapping } from './authorities.profiles';

/**
 * Resolve a dot-path value from a nested object.
 * First tries a direct key lookup (for keys containing dots, e.g., Auth0 namespaced claims),
 * then falls back to dot-separated path traversal.
 *
 * @example
 * resolveDotPath({ a: { b: { c: 42 } } }, 'a.b.c') // 42
 * resolveDotPath({ 'https://myapp.com/roles': ['admin'] }, 'https://myapp.com/roles') // ['admin']
 * resolveDotPath({ a: 1 }, 'a.b') // undefined
 */
export function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  // Direct key lookup first (handles keys with dots like Auth0 namespaced claims)
  if (path in obj) {
    return obj[path];
  }

  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Coerce a value into a string array.
 * Handles: string[] (pass-through), string (space-split), other (empty).
 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * No-op relationship resolver that always denies.
 * Used when no resolver is configured.
 */
const noopRelationshipResolver: RelationshipResolver = {
  async check(): Promise<boolean> {
    return false;
  },
};

/**
 * Function signature for custom claims resolution.
 */
export type ClaimsResolverFn = (authInfo: Partial<AuthInfoLike>) => {
  roles: string[];
  permissions: string[];
  claims: Record<string, unknown>;
};

/**
 * Minimal shape of AuthInfo that the context builder needs.
 * Avoids hard dependency on @frontmcp/protocol.
 */
export interface AuthInfoLike {
  user?: { sub?: string; roles?: string[]; permissions?: string[]; [key: string]: unknown };
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Options for building an evaluation context.
 */
export interface AuthoritiesContextBuilderOptions {
  claimsMapping?: AuthoritiesClaimsMapping;
  claimsResolver?: ClaimsResolverFn;
  relationshipResolver?: RelationshipResolver;
}

/**
 * Builds AuthoritiesEvaluationContext from request-time AuthInfo.
 */
export class AuthoritiesContextBuilder {
  private readonly claimsMapping: AuthoritiesClaimsMapping | undefined;
  private readonly claimsResolver: ClaimsResolverFn | undefined;
  private readonly relationshipResolver: RelationshipResolver;

  constructor(options: AuthoritiesContextBuilderOptions = {}) {
    this.claimsMapping = options.claimsMapping;
    this.claimsResolver = options.claimsResolver;
    this.relationshipResolver = options.relationshipResolver ?? noopRelationshipResolver;
  }

  /**
   * Build an evaluation context from AuthInfo and tool input.
   */
  build(
    authInfo: Partial<AuthInfoLike>,
    input: Record<string, unknown> = {},
    env: Record<string, unknown> = {},
  ): AuthoritiesEvaluationContext {
    // If a custom claimsResolver is provided, use it directly
    if (this.claimsResolver) {
      const resolved = this.claimsResolver(authInfo);
      return {
        user: {
          sub: authInfo?.user?.sub ?? '',
          roles: resolved.roles,
          permissions: resolved.permissions,
          claims: resolved.claims,
        },
        input,
        env,
        relationships: this.relationshipResolver,
      };
    }

    // Extract raw claims from various sources
    const user = authInfo?.user ?? {};
    const authorization = authInfo?.extra?.['authorization'] as Record<string, unknown> | undefined;
    const authorizationClaims = (authorization?.['claims'] as Record<string, unknown>) ?? {};
    // Merge precedence: user fields override authorizationClaims on conflict.
    // This ensures IdP-provided user properties (sub, name, email) take precedence
    // over server-side authorization claims when keys collide.
    const rawClaims: Record<string, unknown> = {
      ...authorizationClaims,
      ...user,
    };

    // Resolve roles via claimsMapping or fallback
    let roles: string[];
    if (this.claimsMapping?.roles) {
      roles = toStringArray(resolveDotPath(rawClaims, this.claimsMapping.roles));
    } else {
      // Fallback chain: user.roles → authorization.scopes → [].
      // OAuth scopes are used as a roles fallback for OAuth integrations where
      // scopes effectively serve as role assignments (e.g., 'admin', 'read').
      // Configure explicit claimsMapping.roles to avoid this behavior.
      roles = toStringArray(
        (user as Record<string, unknown>)['roles'] ??
          (authorization as Record<string, unknown> | undefined)?.['scopes'] ??
          [],
      );
    }

    // Resolve permissions via claimsMapping or fallback
    let permissions: string[];
    if (this.claimsMapping?.permissions) {
      permissions = toStringArray(resolveDotPath(rawClaims, this.claimsMapping.permissions));
    } else {
      permissions = toStringArray((user as Record<string, unknown>)['permissions'] ?? []);
    }

    // Resolve user sub
    const sub = this.claimsMapping?.userId
      ? String(resolveDotPath(rawClaims, this.claimsMapping.userId) ?? '')
      : (user.sub ?? '');

    return {
      user: {
        sub,
        roles,
        permissions,
        claims: rawClaims,
      },
      input,
      env,
      relationships: this.relationshipResolver,
    };
  }
}
