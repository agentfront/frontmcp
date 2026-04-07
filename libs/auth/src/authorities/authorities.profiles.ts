/**
 * Authority Profiles Configuration
 *
 * Types for JWT claims mapping and pre-registered authority profiles.
 * Configured at server/app level via @FrontMcp({ authorities: { ... } })
 */

import type { AuthoritiesPolicyMetadata } from './authorities.types';

// ============================================
// JWT Claims Mapping
// ============================================

/**
 * Maps IdP-specific JWT claim paths to standard authority fields.
 * Each value is a dot-path into the JWT claims object.
 *
 * @example
 * ```typescript
 * // Auth0
 * { roles: 'https://myapp.com/roles', permissions: 'permissions', tenantId: 'org_id' }
 *
 * // Keycloak
 * { roles: 'realm_access.roles', permissions: 'resource_access.account.roles' }
 *
 * // Okta
 * { roles: 'groups', permissions: 'scp' }
 *
 * // Cognito
 * { roles: 'cognito:groups', permissions: 'scope' }
 *
 * // Frontegg
 * { roles: 'roles', permissions: 'permissions', tenantId: 'tenantId' }
 * ```
 */
export interface AuthoritiesClaimsMapping {
  /** Dot-path to roles array in JWT claims */
  roles?: string;
  /** Dot-path to permissions array/string in JWT claims */
  permissions?: string;
  /** Dot-path to tenant/org ID in JWT claims */
  tenantId?: string;
  /** Dot-path to user ID in JWT claims (default: 'sub') */
  userId?: string;
  /** Extensible: additional custom claim mappings */
  [key: string]: string | undefined;
}

// ============================================
// Authorities Config
// ============================================

/**
 * Server/app-level authorities configuration.
 * Registered in `@FrontMcp({ authorities: { ... } })` or `@App({ authorities: { ... } })`.
 *
 * @example
 * ```typescript
 * @FrontMcp({
 *   authorities: {
 *     claimsMapping: { roles: 'realm_access.roles', permissions: 'scope' },
 *     profiles: {
 *       admin: { roles: { any: ['admin', 'superadmin'] } },
 *       authenticated: { attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
 *       matchTenant: { attributes: { conditions: [{ path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } }] } },
 *     },
 *   },
 * })
 * ```
 */
/**
 * Maps authority denials to OAuth scope challenges.
 * When an authority check fails and the denial matches a scopeMapping key,
 * the required scopes are included in the 403 insufficient_scope response.
 * Explicit only — no automatic permission-to-scope inference.
 */
export interface AuthoritiesScopeMapping {
  /** Map role names to required OAuth scopes: `{ admin: ['admin:all'] }` */
  roles?: Record<string, string[]>;
  /** Map permission names to required OAuth scopes: `{ 'repo:write': ['repo'] }` */
  permissions?: Record<string, string[]>;
  /** Map profile names to required OAuth scopes: `{ admin: ['admin:all'] }` */
  profiles?: Record<string, string[]>;
}

export interface AuthoritiesConfig {
  /** JWT claims mapping for your IdP */
  claimsMapping?: AuthoritiesClaimsMapping;
  /** Pre-registered named authority profiles */
  profiles?: Record<string, AuthoritiesPolicyMetadata>;
  /** Map authority denials to OAuth scope challenges */
  scopeMapping?: AuthoritiesScopeMapping;
  /**
   * Auth context pipes — extract custom typed fields from JWT claims.
   * Pipes run during context construction and their results are merged
   * into the FrontMcpAuthContext. Declare custom fields via
   * `declare global { interface ExtendFrontMcpAuthContext { ... } }`.
   */
  pipes?: import('../context/frontmcp-auth-context').AuthContextPipe[];
}
