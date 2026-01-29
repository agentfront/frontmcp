#!/usr/bin/env node

/**
 * Fetch performance baseline from the latest GitHub release.
 *
 * This script:
 * 1. Gets the latest release using GitHub CLI
 * 2. Fetches release comments via GitHub API
 * 3. Parses baseline JSON from comment markers
 * 4. Writes baseline to perf-results/baseline.json
 *
 * Usage:
 *   node scripts/perf-fetch-baseline.mjs
 *   node scripts/perf-fetch-baseline.mjs v1.2.0  # Specific tag
 *
 * Environment:
 *   GITHUB_TOKEN - GitHub token for API access
 *   GITHUB_REPOSITORY - Repository in owner/repo format (auto-detected in CI)
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const BASELINE_START_MARKER = '<!-- PERF_BASELINE_START -->';
const BASELINE_END_MARKER = '<!-- PERF_BASELINE_END -->';
const OUTPUT_PATH = 'perf-results/baseline.json';

/**
 * Execute a command and return stdout.
 */
function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    console.error(error.message);
    return null;
  }
}

/**
 * Get repository info from git or environment.
 */
function getRepoInfo() {
  // Check environment first (CI)
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    return { owner, repo };
  }

  // Try to get from git remote
  const remoteUrl = exec('git remote get-url origin');
  if (!remoteUrl) {
    throw new Error('Could not determine repository info');
  }

  // Parse github.com/owner/repo or git@github.com:owner/repo
  const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse repository from: ${remoteUrl}`);
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Get the latest release tag using GitHub CLI.
 */
function getLatestRelease() {
  const result = exec('gh release list --limit 1 --json tagName');
  if (!result) {
    return null;
  }

  try {
    const releases = JSON.parse(result);
    return releases[0]?.tagName || null;
  } catch {
    return null;
  }
}

/**
 * Get release comments via GitHub API.
 */
async function getReleaseComments(owner, repo, tag) {
  // First get the release ID
  const releaseJson = exec(`gh api repos/${owner}/${repo}/releases/tags/${tag}`);
  if (!releaseJson) {
    return [];
  }

  let releaseId;
  try {
    const release = JSON.parse(releaseJson);
    releaseId = release.id;
  } catch {
    console.error('Failed to parse release JSON');
    return [];
  }

  // Get comments for this release
  // Note: GitHub doesn't have a direct API for release comments,
  // so we check if the baseline is in the release body instead
  const releaseData = JSON.parse(releaseJson);

  // Check release body for baseline
  if (releaseData.body && releaseData.body.includes(BASELINE_START_MARKER)) {
    return [{ body: releaseData.body }];
  }

  // Try to get discussions/comments if available
  // For now, return empty if not in body
  return [];
}

/**
 * Parse baseline from comment body.
 */
function parseBaseline(body) {
  const startIdx = body.indexOf(BASELINE_START_MARKER);
  const endIdx = body.indexOf(BASELINE_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null;
  }

  const content = body.substring(startIdx + BASELINE_START_MARKER.length, endIdx);

  // Extract JSON from markdown code block
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    console.error('Failed to parse baseline JSON');
    return null;
  }
}

/**
 * Main function.
 */
async function main() {
  console.log('[perf-fetch-baseline] Starting...');

  // Get target tag
  const targetTag = process.argv[2];
  let tag = targetTag;

  if (!tag) {
    console.log('[perf-fetch-baseline] No tag specified, finding latest release...');
    tag = getLatestRelease();

    if (!tag) {
      console.log('[perf-fetch-baseline] No releases found. Skipping baseline fetch.');
      process.exit(0);
    }
  }

  console.log(`[perf-fetch-baseline] Fetching baseline from release: ${tag}`);

  // Get repo info
  const { owner, repo } = getRepoInfo();
  console.log(`[perf-fetch-baseline] Repository: ${owner}/${repo}`);

  // Get release comments
  const comments = await getReleaseComments(owner, repo, tag);

  if (comments.length === 0) {
    console.log('[perf-fetch-baseline] No baseline found in release. This may be expected for new releases.');
    process.exit(0);
  }

  // Find and parse baseline
  let baseline = null;
  for (const comment of comments) {
    baseline = parseBaseline(comment.body);
    if (baseline) {
      break;
    }
  }

  if (!baseline) {
    console.log('[perf-fetch-baseline] No valid baseline found in release comments.');
    process.exit(0);
  }

  // Write baseline to file
  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(baseline, null, 2));
  console.log(`[perf-fetch-baseline] Baseline written to: ${OUTPUT_PATH}`);
  console.log(`[perf-fetch-baseline] Baseline from: ${baseline.release} (${baseline.timestamp})`);
  console.log(`[perf-fetch-baseline] Tests: ${Object.keys(baseline.tests).length}`);
}

main().catch((error) => {
  console.error('[perf-fetch-baseline] Error:', error.message);
  process.exit(1);
});
