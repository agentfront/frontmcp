/**
 * Scope Mapping Resolver
 *
 * Resolves required OAuth scopes from a structured authority denial
 * using explicit scopeMapping configuration.
 */

import type { AuthoritiesDenial, AuthoritiesMetadata } from './authorities.types';
import type { AuthoritiesScopeMapping } from './authorities.profiles';

/**
 * Resolve required OAuth scopes from a structured denial and scopeMapping.
 * Returns undefined if no mapping matches the denial.
 *
 * Uses explicit mapping only — no automatic permission-to-scope inference.
 */
export function resolveRequiredScopes(
  denial: AuthoritiesDenial,
  mapping: AuthoritiesScopeMapping,
  authorities: AuthoritiesMetadata,
): string[] | undefined {
  const scopes = new Set<string>();

  // Profile-level mapping: authorities is a string profile name
  if (typeof authorities === 'string' && mapping.profiles?.[authorities]) {
    mapping.profiles[authorities].forEach((s) => scopes.add(s));
  }

  // Profile array: check each profile name
  if (Array.isArray(authorities)) {
    for (const profileName of authorities) {
      if (typeof profileName === 'string' && mapping.profiles?.[profileName]) {
        mapping.profiles[profileName].forEach((s) => scopes.add(s));
      }
    }
  }

  // Role denial → role scope mapping
  if (denial.kind === 'roles' && denial.missing && mapping.roles) {
    for (const role of denial.missing) {
      const mapped = mapping.roles[role];
      if (mapped) mapped.forEach((s) => scopes.add(s));
    }
  }

  // Permission denial → permission scope mapping
  if (denial.kind === 'permissions' && denial.missing && mapping.permissions) {
    for (const perm of denial.missing) {
      const mapped = mapping.permissions[perm];
      if (mapped) mapped.forEach((s) => scopes.add(s));
    }
  }

  return scopes.size > 0 ? [...scopes].sort() : undefined;
}
