#!/usr/bin/env node
/**
 * Computes the next patch version for a release line based on git tags.
 *
 * Usage:
 *   node scripts/compute-next-patch.mjs <release-line> [release-type] [pre-release-number]
 *
 * Examples:
 *   node scripts/compute-next-patch.mjs 1.4           # Returns 1.4.3 (if 1.4.2 exists)
 *   node scripts/compute-next-patch.mjs 1.4 rc 1      # Returns 1.4.3-rc.1
 *   node scripts/compute-next-patch.mjs 1.4 beta      # Returns 1.4.3-beta.1 (auto-increment)
 *   node scripts/compute-next-patch.mjs 1.4 rc        # Returns 1.4.3-rc.1 (or rc.2 if rc.1 exists)
 */

import { execSync } from 'node:child_process';

/**
 * Escape all regex special characters in a string.
 * Prevents regex injection when building patterns from user input.
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const [, , releaseLine, releaseType = 'stable', preReleaseNumArg] = process.argv;

if (!releaseLine) {
  console.error('Usage: compute-next-patch.mjs <release-line> [release-type] [pre-release-number]');
  console.error('  release-line: X.Y (e.g., 1.4)');
  console.error('  release-type: stable, rc, or beta (default: stable)');
  console.error('  pre-release-number: N for -rc.N or -beta.N (optional, auto-increments if not provided)');
  process.exit(1);
}

const allowedReleaseTypes = new Set(['stable', 'rc', 'beta']);
if (!allowedReleaseTypes.has(releaseType)) {
  console.error(`Invalid release type: ${releaseType}. Expected: stable, rc, or beta.`);
  process.exit(1);
}

// Validate release line format
if (!/^\d+\.\d+$/.test(releaseLine)) {
  console.error(`Invalid release line format: ${releaseLine}. Expected format: X.Y (e.g., 1.4)`);
  process.exit(1);
}

if (releaseType === 'stable' && typeof preReleaseNumArg !== 'undefined' && preReleaseNumArg !== '') {
  console.error('pre-release-number is only valid for rc/beta releases.');
  process.exit(1);
}

// Get all tags for this release line
let tags = [];
try {
  const output = execSync(`git tag --list "v${releaseLine}.*" --sort=-version:refname`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  tags = output.trim().split('\n').filter(Boolean);
} catch {
  // No tags found, that's OK
  tags = [];
}

// Find highest stable version to determine next patch number
const stableTags = tags.filter((t) => !t.includes('-'));
let nextPatch = 0;

if (stableTags.length > 0) {
  const escapedReleaseLine = escapeRegExp(releaseLine);
  const stableTagPattern = new RegExp(`^v${escapedReleaseLine}\\.(\\d+)$`);
  for (const tag of stableTags) {
    const match = tag.match(stableTagPattern);
    if (match) {
      nextPatch = parseInt(match[1], 10) + 1;
      break;
    }
  }
}

let version = `${releaseLine}.${nextPatch}`;

// Handle pre-release suffixes
if (releaseType === 'rc' || releaseType === 'beta') {
  let preReleaseNum = preReleaseNumArg ? parseInt(preReleaseNumArg, 10) : null;

  if (preReleaseNumArg) {
    if (!/^\d+$/.test(preReleaseNumArg) || !Number.isFinite(preReleaseNum) || preReleaseNum < 1) {
      console.error(`Invalid pre-release number: ${preReleaseNumArg}. Expected a positive integer (e.g., 1).`);
      process.exit(1);
    }
  }

  if (preReleaseNum === null) {
    // Auto-increment pre-release number
    const preReleaseTags = tags.filter((t) => t.includes(`-${releaseType}.`));
    const targetVersionTags = preReleaseTags.filter((t) => t.startsWith(`v${version}-${releaseType}.`));

    if (targetVersionTags.length === 0) {
      preReleaseNum = 1;
    } else {
      // Find highest pre-release number for this version
      let maxPreRelease = 0;
      for (const tag of targetVersionTags) {
        const preMatch = tag.match(new RegExp(`-${releaseType}\\.(\\d+)`));
        if (preMatch) {
          const num = parseInt(preMatch[1], 10);
          if (num > maxPreRelease) {
            maxPreRelease = num;
          }
        }
      }
      preReleaseNum = maxPreRelease + 1;
    }
  }

  version = `${version}-${releaseType}.${preReleaseNum}`;
}

// Output just the version (no newline for use in shell scripts)
process.stdout.write(version);
