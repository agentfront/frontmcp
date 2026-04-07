/**
 * FrontMcpAuthContext — FrontMCP's own auth identity interface.
 *
 * Extensible via `declare global { interface ExtendFrontMcpAuthContext { ... } }`.
 * Custom fields are populated by auth context pipes registered in
 * `@FrontMcp({ authorities: { pipes: [...] } })`.
 */

// ============================================
// Extension Interface
// ============================================

/**
 * Global extension interface for FrontMcpAuthContext.
 * Developers augment this to add custom typed fields extracted from JWT claims.
 *
 * @example
 * ```typescript
 * declare global {
 *   interface ExtendFrontMcpAuthContext {
 *     tenantId: string;
 *     orgName: string;
 *     subscription: { plan: string; active: boolean };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ExtendFrontMcpAuthContext {}
}

/**
 * Pipe function that extracts custom fields from JWT claims during context construction.
 * Can be sync or async (for DB/Redis lookups).
 *
 * @example
 * ```typescript
 * const extractTenant: AuthContextPipe = (claims) => ({
 *   tenantId: claims['tenantId'] as string ?? '',
 * });
 *
 * const lookupSubscription: AuthContextPipe = async (claims) => {
 *   const plan = await db.query('SELECT plan FROM orgs WHERE id=$1', [claims['org_id']]);
 *   return { subscription: { plan: plan?.name ?? 'free', active: !!plan?.active } };
 * };
 * ```
 */
export type AuthContextPipe = (
  claims: Readonly<Record<string, unknown>>,
) => Partial<ExtendFrontMcpAuthContext> | Promise<Partial<ExtendFrontMcpAuthContext>>;

// ============================================
// User Identity
// ============================================

/**
 * User identity attached to a FrontMcpAuthContext.
 */
export interface FrontMcpAuthUser {
  /** Subject identifier (e.g., JWT `sub` claim) */
  readonly sub: string;
  /** Display name */
  readonly name?: string;
  /** Email address */
  readonly email?: string;
  /** Avatar URL */
  readonly picture?: string;
}

/**
 * Rich authentication context for FrontMCP request processing.
 *
 * Built from raw auth info (e.g., AuthInfo from MCP SDK) plus an optional
 * {@link AuthoritiesClaimsMapping} that tells the builder where to find
 * roles and permissions in IdP-specific JWT shapes.
 *
 * @example
 * ```typescript
 * if (ctx.isAnonymous) {
 *   throw new Error('Authentication required');
 * }
 * if (!ctx.hasRole('admin')) {
 *   throw new Error('Admin role required');
 * }
 * if (!ctx.hasAllScopes(['read', 'write'])) {
 *   throw new Error('Insufficient scopes');
 * }
 * ```
 */
export interface FrontMcpAuthContext extends ExtendFrontMcpAuthContext {
  /** Resolved user identity */
  readonly user: FrontMcpAuthUser;

  /** True when the user is anonymous (sub starts with `anon:` or is empty) */
  readonly isAnonymous: boolean;

  /** Authentication mode (e.g., 'public', 'transparent', 'orchestrated') */
  readonly mode: string;

  /** Session identifier (empty string if no session) */
  readonly sessionId: string;

  /** OAuth scopes granted to this session */
  readonly scopes: readonly string[];

  /** Raw JWT claims (merged from user + extra.authorization.claims) */
  readonly claims: Readonly<Record<string, unknown>>;

  /** Resolved roles (via claimsMapping or direct extraction) */
  readonly roles: readonly string[];

  /** Resolved permissions (via claimsMapping or direct extraction) */
  readonly permissions: readonly string[];

  /** Check whether the user has a specific role */
  hasRole(role: string): boolean;

  /** Check whether the user has a specific permission */
  hasPermission(permission: string): boolean;

  /** Check whether the session has a specific OAuth scope */
  hasScope(scope: string): boolean;

  /** Check whether the session has ALL of the specified OAuth scopes */
  hasAllScopes(scopes: readonly string[]): boolean;
}
