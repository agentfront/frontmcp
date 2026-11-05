// file: libs/adapters/src/skills/bundle/bundle-version.ts

import { compareVersions, isValidVersion } from '@frontmcp/sdk';

import type { ResolvedBundle } from './bundle.types';

type BundleVersionFields = Pick<ResolvedBundle, 'version' | 'generatedAt'>;

/**
 * Order two bundles: negative when `bundle` is older than `other`, positive when it is newer, zero when neither is.
 * Two semver versions order by semver precedence. Versions equal by it (a bundle re-signed under its version), or
 * not both semver, order by `generatedAt`, which the bundle's signature covers.
 */
export function compareBundleVersions(bundle: BundleVersionFields, other: BundleVersionFields): number {
  if (isValidVersion(bundle.version) && isValidVersion(other.version)) {
    const bySemver = compareVersions(bundle.version, other.version);
    if (bySemver !== 0) return bySemver;
  }
  return Date.parse(bundle.generatedAt) - Date.parse(other.generatedAt);
}
