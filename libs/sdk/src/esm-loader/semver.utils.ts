/**
 * @file semver.utils.ts
 * @description Thin wrapper around the `semver` package for version comparison utilities.
 * Isolates the semver dependency to a single file for easier maintenance.
 */

import * as semver from 'semver';

/**
 * Check if a specific version satisfies a semver range.
 *
 * @param version - Concrete version string (e.g., '1.2.3')
 * @param range - Semver range string (e.g., '^1.0.0', '>=2.0.0', 'latest')
 * @returns true if the version satisfies the range
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (range === 'latest' || range === '*') return true;
  return semver.satisfies(version, range);
}

/**
 * Find the highest version in a list that satisfies a semver range.
 *
 * @param versions - Array of version strings
 * @param range - Semver range to match against
 * @returns The highest matching version, or null if none match
 */
export function maxSatisfying(versions: string[], range: string): string | null {
  if (range === 'latest' || range === '*') {
    const sorted = versions.filter((v) => semver.valid(v)).sort(semver.rcompare);
    return sorted[0] ?? null;
  }
  return semver.maxSatisfying(versions, range);
}

/**
 * Check if a string is a valid semver range.
 */
export function isValidRange(range: string): boolean {
  if (range === 'latest' || range === '*') return true;
  return semver.validRange(range) !== null;
}

/**
 * Check if a string is a valid semver version.
 */
export function isValidVersion(version: string): boolean {
  return semver.valid(version) !== null;
}

/**
 * Compare two versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  return semver.compare(v1, v2);
}

/**
 * Check if v1 is greater than v2.
 */
export function isNewerVersion(v1: string, v2: string): boolean {
  return semver.gt(v1, v2);
}
