import { compareVersions, isValidVersion } from '../esm-loader/semver.utils';

/** How `version` orders against `own`: below 0 when older, 0 when the same, above 0 when newer; `undefined` when unordered. */
export function compareSharedVersions(version: string, own: string): number | undefined {
  if (version === own) return 0;
  if (!isValidVersion(version) || !isValidVersion(own)) return undefined;
  return compareVersions(version, own);
}
