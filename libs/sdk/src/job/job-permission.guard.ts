import { JobPermission, JobPermissionAction } from '../common/metadata/job.metadata';

/**
 * Permission guard for jobs and workflows.
 * Checks JobPermission[] against authInfo for each action.
 */
export class JobPermissionGuard {
  /**
   * Check if the given auth info is allowed to perform the action.
   * Returns true if no permissions are defined (permissive by default).
   */
  static async check(
    permissions: JobPermission[] | undefined,
    action: JobPermissionAction,
    authInfo: Partial<Record<string, unknown>>,
  ): Promise<boolean> {
    if (!permissions || permissions.length === 0) {
      return true; // No permissions = allow all
    }

    // Find permissions matching this action
    const relevant = permissions.filter((p) => p.action === action);
    if (relevant.length === 0) {
      return true; // No permission rules for this action = allow
    }

    // All relevant permissions must pass
    for (const perm of relevant) {
      const passed = await JobPermissionGuard.checkSingle(perm, authInfo);
      if (!passed) return false;
    }

    return true;
  }

  private static async checkSingle(perm: JobPermission, authInfo: Partial<Record<string, unknown>>): Promise<boolean> {
    // Check roles
    if (perm.roles && perm.roles.length > 0) {
      const userRoles = authInfo['roles'];
      if (!Array.isArray(userRoles)) return false;
      const hasRole = perm.roles.some((r) => userRoles.includes(r));
      if (!hasRole) return false;
    }

    // Check scopes
    if (perm.scopes && perm.scopes.length > 0) {
      const userScopes = authInfo['scopes'] ?? authInfo['scope'];
      const scopeArr =
        typeof userScopes === 'string' ? userScopes.split(' ') : Array.isArray(userScopes) ? userScopes : [];
      const hasScope = perm.scopes.some((s) => scopeArr.includes(s));
      if (!hasScope) return false;
    }

    // Check custom function
    if (perm.custom) {
      const result = await perm.custom(authInfo);
      if (!result) return false;
    }

    return true;
  }
}
