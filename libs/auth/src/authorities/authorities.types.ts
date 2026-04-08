/**
 * Authorities Type Definitions
 *
 * Core types for the built-in RBAC, ABAC, and ReBAC authorization system.
 * These types are used in decorator metadata across all entry types
 * (Tools, Resources, Prompts, Skills, Agents).
 */

// ============================================
// RBAC — Role-Based Access Control
// ============================================

/**
 * Role-based policy. At least one of `all` or `any` must be specified.
 *
 * - `all`: user must have **every** listed role (AND)
 * - `any`: user must have **at least one** listed role (OR)
 *
 * When both are set, both conditions must be satisfied.
 */
export interface RbacRolesPolicy {
  /** User must have ALL of these roles */
  all?: string[];
  /** User must have at least ONE of these roles */
  any?: string[];
}

/**
 * Permission-based policy. Same semantics as {@link RbacRolesPolicy}.
 */
export interface RbacPermissionsPolicy {
  /** User must have ALL of these permissions */
  all?: string[];
  /** User must have at least ONE of these permissions */
  any?: string[];
}

// ============================================
// ABAC — Attribute-Based Access Control
// ============================================

/**
 * Operators for ABAC condition evaluation.
 */
export type AbacOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists'
  | 'matches';

/**
 * Dynamic value reference resolved at evaluation time.
 * Used in ABAC conditions and ReBAC resource IDs.
 */
export type DynamicValueRef = { fromInput: string } | { fromClaims: string };

/**
 * A single ABAC condition.
 *
 * @example
 * ```typescript
 * { path: 'user.department', op: 'eq', value: 'engineering' }
 * { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } }
 * { path: 'env.NODE_ENV', op: 'in', value: ['staging', 'production'] }
 * ```
 */
export interface AbacCondition {
  /**
   * Dot-path into the evaluation context envelope.
   * Prefixes: `user.*`, `claims.*`, `input.*`, `env.*`
   */
  path: string;
  /** Comparison operator */
  op: AbacOperator;
  /**
   * Value to compare against.
   * Can be a literal or a {@link DynamicValueRef} resolved at runtime.
   */
  value: unknown;
}

/**
 * Attribute-based policy. At least one of `match` or `conditions` must be specified.
 */
export interface AbacPolicy {
  /**
   * Simple equality checks: each key is a dot-path, value is the expected value.
   * All pairs must match (AND semantics).
   */
  match?: Record<string, unknown>;
  /**
   * Advanced conditions with operators. All conditions must pass (AND semantics).
   */
  conditions?: AbacCondition[];
}

// ============================================
// ReBAC — Relationship-Based Access Control
// ============================================

/**
 * How to resolve a resource ID at evaluation time.
 */
export type ResourceIdRef = string | { fromInput: string } | { fromClaims: string };

/**
 * A relationship-based access check.
 *
 * @example
 * ```typescript
 * { type: 'member', resource: 'site', resourceId: { fromInput: 'siteId' } }
 * { type: 'owner', resource: 'document', resourceId: { fromClaims: 'user.docId' } }
 * ```
 */
export interface RebacPolicy {
  /** Relationship type (e.g., 'owner', 'member', 'viewer') */
  type: string;
  /** Resource type (e.g., 'site', 'org', 'document') */
  resource: string;
  /** Resource identifier — literal string, from input, or from claims */
  resourceId: ResourceIdRef;
}

// ============================================
// Composable Policy (inline object form)
// ============================================

/**
 * A composable authorization policy supporting RBAC, ABAC, ReBAC, and custom evaluators.
 *
 * Multiple fields are combined using `operator` (default `'AND'`).
 * Use `allOf`, `anyOf`, `not` for complex compositions.
 */
/**
 * Async guard function for dynamic authorization checks (DB/Redis/API calls).
 * Returns `true` if granted, or a `string` denial message if denied.
 *
 * @example
 * ```typescript
 * const guard: AuthorityGuardFn = async (ctx) => {
 *   const allowed = await redis.sismember('allowed-tenants', ctx.input['tenantId']);
 *   return allowed ? true : 'tenant not in allowlist';
 * };
 * ```
 */
export type AuthorityGuardFn = (ctx: AuthoritiesEvaluationContext) => boolean | string | Promise<boolean | string>;

export interface AuthoritiesPolicyMetadata {
  /** RBAC: required roles */
  roles?: RbacRolesPolicy;
  /** RBAC: required permissions */
  permissions?: RbacPermissionsPolicy;
  /** ABAC: attribute-based conditions */
  attributes?: AbacPolicy;
  /** ReBAC: relationship-based checks */
  relationships?: RebacPolicy | RebacPolicy[];
  /** Custom evaluator policies (key = evaluator name, value = evaluator-specific config) */
  custom?: Record<string, unknown>;
  /**
   * Async guard functions for dynamic authorization (DB/Redis/API lookups).
   * Each guard runs in sequence. If any returns `false` or a denial string, access is denied.
   * Guards are combined with other policy fields via `operator` (default AND).
   */
  guards?: AuthorityGuardFn[];
  /** How to combine top-level fields. Default: `'AND'` */
  operator?: 'AND' | 'OR';
  /** Negate a nested policy */
  not?: AuthoritiesPolicyMetadata;
  /** At least one nested policy must pass (OR combinator) */
  anyOf?: AuthoritiesPolicyMetadata[];
  /** All nested policies must pass (AND combinator) */
  allOf?: AuthoritiesPolicyMetadata[];
}

// ============================================
// Authority Profiles
// ============================================

/**
 * Global extensible interface for authority profile names.
 * Developers augment this to get type-safe profile references.
 *
 * @example
 * ```typescript
 * declare global {
 *   interface FrontMcpAuthorityProfiles {
 *     admin: true;
 *     authenticated: true;
 *     matchTenant: true;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface FrontMcpAuthorityProfiles {
    [key: string]: true;
  }
}

/**
 * A registered authority profile name.
 * Type-safe when {@link FrontMcpAuthorityProfiles} is augmented.
 */
export type AuthorityProfileName = string & keyof FrontMcpAuthorityProfiles;

// ============================================
// Unified AuthoritiesMetadata
// ============================================

/**
 * The unified `authorities` field accepted by all entry decorators.
 *
 * Three forms:
 * 1. **String** — reference to a registered profile: `'admin'`
 * 2. **String array** — multiple profiles evaluated as AND: `['authenticated', 'matchTenant']`
 * 3. **Policy object** — inline RBAC/ABAC/ReBAC policy
 *
 * @example
 * ```typescript
 * // Profile reference
 * @Tool({ authorities: 'admin' })
 *
 * // Multiple profiles
 * @Tool({ authorities: ['authenticated', 'matchTenant'] })
 *
 * // Inline policy
 * @Tool({ authorities: { roles: { any: ['admin'] }, permissions: { all: ['users:delete'] } } })
 * ```
 */
export type AuthoritiesMetadata = AuthorityProfileName | AuthorityProfileName[] | AuthoritiesPolicyMetadata;

// ============================================
// Evaluation Result
// ============================================

/**
 * Structured denial data from an authorities evaluation.
 */
export interface AuthoritiesDenial {
  /** Which policy type caused the denial */
  kind: 'roles' | 'permissions' | 'attributes' | 'relationships' | 'custom' | 'profile' | 'not' | 'allOf' | 'anyOf';
  /** Dot-path into the policy that failed (e.g., "roles.all", "attributes.conditions[0]") */
  path: string;
  /** Values that were required but missing */
  missing?: string[];
  /** Expected value */
  expected?: unknown;
  /** Actual value found */
  actual?: unknown;
}

/**
 * Result of evaluating an authorities policy.
 */
export interface AuthoritiesResult {
  /** Whether access was granted */
  granted: boolean;
  /** Human-readable reason for denial (kept for backward compatibility) */
  deniedBy?: string;
  /** Structured denial data (machine-parsable) */
  denial?: AuthoritiesDenial;
  /** List of policy types that were evaluated (for audit) */
  evaluatedPolicies: string[];
  /** Optional detailed message */
  message?: string;
}

// ============================================
// Relationship Resolver
// ============================================

/**
 * Interface for resolving relationship-based access checks.
 * Implement this to integrate with your authorization backend
 * (e.g., SpiceDB, OpenFGA, custom DB queries).
 */
export interface RelationshipResolver {
  /**
   * Check if a user has a relationship to a resource.
   *
   * @param type - Relationship type (e.g., 'member', 'owner')
   * @param resource - Resource type (e.g., 'site', 'org')
   * @param resourceId - Resolved resource identifier
   * @param userSub - User subject identifier
   * @param ctx - Full evaluation context
   */
  check(
    type: string,
    resource: string,
    resourceId: string,
    userSub: string,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<boolean>;
}

// ============================================
// Evaluation Context
// ============================================

/**
 * Context provided to the evaluation engine for policy checks.
 * Built from AuthInfo + claimsMapping at request time.
 */
export interface AuthoritiesEvaluationContext {
  /** Resolved user information */
  user: {
    /** User subject identifier */
    sub: string;
    /** User roles (extracted via claimsMapping) */
    roles: string[];
    /** User permissions (extracted via claimsMapping) */
    permissions: string[];
    /** Raw JWT claims */
    claims: Record<string, unknown>;
  };
  /** Tool/prompt input arguments */
  input: Record<string, unknown>;
  /** Runtime environment variables */
  env: Record<string, unknown>;
  /** Relationship resolver for ReBAC checks */
  relationships: RelationshipResolver;
}

// ============================================
// Custom Evaluator
// ============================================

/**
 * Interface for custom authority evaluators.
 * Register via `AuthoritiesPlugin.init({ evaluators: { ... } })`.
 *
 * @example
 * ```typescript
 * const ipAllowListEvaluator: AuthoritiesEvaluator = {
 *   name: 'ipAllowList',
 *   evaluate: async (policy, ctx) => {
 *     const { cidr } = policy as { cidr: string[] };
 *     const allowed = cidr.some(c => isInCidr(ctx.env.remoteIp, c));
 *     return { granted: allowed, evaluatedPolicies: ['custom.ipAllowList'] };
 *   },
 * };
 * ```
 */
export interface AuthoritiesEvaluator {
  /** Evaluator name (must match the key under `custom.*` in policies) */
  name: string;
  /** Evaluate the policy against the context */
  evaluate(policy: unknown, ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult>;
}
