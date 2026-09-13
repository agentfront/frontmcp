import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { type JobPermission, type JobPermissionAction } from '../common/metadata/job.metadata';
import { resolvePrincipal, type ResolvedPrincipal } from '../common/utils/principal.utils';

/**
 * Permission guard for jobs and workflows.
 *
 * Evaluates the `permissions` declared by `@Job` / `@Workflow` against the
 * caller. The contract is deliberately permissive at the edges and strict in the
 * middle:
 *
 *  - no `permissions` at all, or none matching the action → ALLOW. This is the
 *    documented behaviour ("when no permissions are defined, the job is
 *    accessible to all authenticated users") and changing it would break every
 *    existing server.
 *  - one or more rules match the action → ALL of them must pass, and within a
 *    rule the roles/scopes lists are ANY-of.
 *
 * Claims are resolved through {@link resolvePrincipal}, so a server that
 * configured `authorities.claimsMapping` gets its own mapping honoured here
 * rather than a second, divergent notion of where roles live.
 */
export class JobPermissionGuard {
  /**
   * Check whether the caller may perform `action`.
   *
   * @param permissions - the entry's declared rules (undefined = unrestricted).
   * @param action - the action being attempted.
   * @param authInfo - the request's AuthInfo.
   * @param contextBuilder - the scope's authorities context builder, when configured.
   */
  static async check(
    permissions: JobPermission[] | undefined,
    action: JobPermissionAction,
    authInfo: Partial<Record<string, unknown>> | undefined,
    contextBuilder?: AuthoritiesContextBuilder,
  ): Promise<boolean> {
    if (!permissions || permissions.length === 0) {
      return true; // No permissions = allow all
    }

    // Find permissions matching this action
    const relevant = permissions.filter((p) => p.action === action);
    if (relevant.length === 0) {
      return true; // No permission rules for this action = allow
    }

    const principal = resolvePrincipal(authInfo, contextBuilder);

    // All relevant permissions must pass
    for (const perm of relevant) {
      const passed = await JobPermissionGuard.checkSingle(perm, principal, authInfo);
      if (!passed) return false;
    }

    return true;
  }

  private static async checkSingle(
    perm: JobPermission,
    principal: ResolvedPrincipal,
    authInfo: Partial<Record<string, unknown>> | undefined,
  ): Promise<boolean> {
    if (perm.roles && perm.roles.length > 0) {
      if (!perm.roles.some((role) => principal.roles.includes(role))) return false;
    }

    if (perm.scopes && perm.scopes.length > 0) {
      if (!perm.scopes.some((scope) => principal.scopes.includes(scope))) return false;
    }

    if (perm.custom) {
      // Custom rules receive the raw AuthInfo — they are application code and
      // may legitimately look at anything on the request, not just the
      // normalized principal.
      const result = await perm.custom((authInfo ?? {}) as Partial<Record<string, unknown>>);
      if (!result) return false;
    }

    return true;
  }
}
