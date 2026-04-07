/**
 * Options for the AuthoritiesPlugin.
 */

import type {
  AuthoritiesClaimsMapping,
  AuthoritiesPolicyMetadata,
  RelationshipResolver,
  AuthoritiesEvaluator,
  ClaimsResolverFn,
} from '@frontmcp/auth';

/**
 * Configuration options for `AuthoritiesPlugin.init()`.
 *
 * @example
 * ```typescript
 * AuthoritiesPlugin.init({
 *   claimsMapping: { roles: 'realm_access.roles', permissions: 'scope' },
 *   profiles: {
 *     admin: { roles: { any: ['admin'] } },
 *     matchTenant: { attributes: { conditions: [{ path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } }] } },
 *   },
 * })
 * ```
 */
export interface AuthoritiesPluginOptions {
  /**
   * JWT claims mapping for your IdP.
   * Tells the engine where roles, permissions, tenant ID etc. are located in the JWT.
   */
  claimsMapping?: AuthoritiesClaimsMapping;

  /**
   * Custom function to extract roles/permissions/claims from AuthInfo.
   * Takes precedence over `claimsMapping` when provided.
   */
  claimsResolver?: ClaimsResolverFn;

  /**
   * Pre-registered named authority profiles.
   * Allows `authorities: 'admin'` shorthand in decorators.
   */
  profiles?: Record<string, AuthoritiesPolicyMetadata>;

  /**
   * Relationship resolver for ReBAC checks.
   * Required when using `relationships` in policies.
   */
  relationshipResolver?: RelationshipResolver;

  /**
   * Custom evaluators for the `custom.*` field in policies.
   */
  evaluators?: Record<string, AuthoritiesEvaluator>;
}
