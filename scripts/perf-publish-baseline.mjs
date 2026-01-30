#!/usr/bin/env node

/**
 * Publish performance baseline to a GitHub release.
 *
 * This script:
 * 1. Reads perf-results/report.json
 * 2. Converts it to baseline format
 * 3. Posts as a comment to the specified release tag
 *
 * Usage:
 *   node scripts/perf-publish-baseline.mjs v1.2.0
 *
 * Environment:
 *   GITHUB_TOKEN - GitHub token for API access
 *   GITHUB_REPOSITORY - Repository in owner/repo format (auto-detected in CI)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASELINE_START_MARKER = '<!-- PERF_BASELINE_START -->';
const BASELINE_END_MARKER = '<!-- PERF_BASELINE_END -->';

/**
 * Execute a command and return stdout.
 */
function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    if (!options.silent) {
      console.error(`Command failed: ${cmd}`);
      console.error(error.message);
    }
    return null;
  }
}

/**
 * Get repository info from git or environment.
 */
function getRepoInfo() {
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    return { owner, repo };
  }

  const remoteUrl = exec('git remote get-url origin');
  if (!remoteUrl) {
    throw new Error('Could not determine repository info');
  }

  const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse repository from: ${remoteUrl}`);
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Get current git commit hash.
 */
function getCommitHash() {
  return process.env.GITHUB_SHA || exec('git rev-parse HEAD') || undefined;
}

/**
 * Load and merge reports from all projects.
 */
function loadReports() {
  const reports = [];
  const baseDir = 'perf-results';

  if (!existsSync(baseDir)) {
    return null;
  }

  // Check for consolidated report
  const consolidatedPath = join(baseDir, 'report.json');
  if (existsSync(consolidatedPath)) {
    try {
      const report = JSON.parse(readFileSync(consolidatedPath, 'utf8'));
      return report;
    } catch {
      console.warn('Failed to parse consolidated report');
    }
  }

  // Load individual project reports
  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const dir of dirs) {
    const reportPath = join(baseDir, dir, 'report.json');
    if (existsSync(reportPath)) {
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        reports.push(report);
      } catch {
        console.warn(`Failed to parse report: ${reportPath}`);
      }
    }
  }

  if (reports.length === 0) {
    return null;
  }

  // Merge reports
  const merged = {
    timestamp: new Date().toISOString(),
    commitHash: getCommitHash(),
    summary: {
      totalTests: 0,
      passedTests: 0,
      warningTests: 0,
      failedTests: 0,
      leakTests: 0,
    },
    projects: [],
  };

  for (const report of reports) {
    if (!report.summary) {
      console.warn(`Report missing summary, skipping`);
      continue;
    }
    merged.summary.totalTests += report.summary.totalTests ?? 0;
    merged.summary.passedTests += report.summary.passedTests ?? 0;
    merged.summary.warningTests += report.summary.warningTests ?? 0;
    merged.summary.failedTests += report.summary.failedTests ?? 0;
    merged.summary.leakTests += report.summary.leakTests ?? 0;
    if (Array.isArray(report.projects)) {
      merged.projects.push(...report.projects);
    }
  }

  return merged;
}

/**
 * Convert report to consolidated format with full test data mapped by name.
 * Maintains backward compatibility with regression detection (heapUsed, durationMs, cpuTime fields).
 */
function reportToBaseline(report, release) {
  const tests = {};

  for (const project of report.projects) {
    for (const measurement of project.measurements) {
      const testId = `${measurement.project}::${measurement.name}`;

      tests[testId] = {
        // Required fields for TestBaseline interface (regression detection)
        testId,
        project: measurement.project,
        heapUsed: {
          mean: measurement.final?.memory?.heapUsed || 0,
          stdDev: 0,
          min: measurement.final?.memory?.heapUsed || 0,
          max: measurement.final?.memory?.heapUsed || 0,
          p95: measurement.final?.memory?.heapUsed || 0,
          sampleCount: 1,
        },
        durationMs: {
          mean: measurement.timing?.durationMs ?? 0,
          stdDev: 0,
          min: measurement.timing?.durationMs ?? 0,
          max: measurement.timing?.durationMs ?? 0,
          p95: measurement.timing?.durationMs ?? 0,
          sampleCount: measurement.timing ? 1 : 0,
        },
        cpuTime: {
          mean: measurement.final?.cpu?.total || 0,
          stdDev: 0,
          min: measurement.final?.cpu?.total || 0,
          max: measurement.final?.cpu?.total || 0,
          p95: measurement.final?.cpu?.total || 0,
          sampleCount: 1,
        },
        createdAt: new Date().toISOString(),
        commitHash: report.commitHash,

        // Extended fields - full measurement data
        name: measurement.name,
        timing: measurement.timing,
        baseline: measurement.baseline,
        final: measurement.final,
        memoryDelta: measurement.memoryDelta,
        issues: measurement.issues || [],
        leakDetectionResults: measurement.leakDetectionResults,
      };
    }
  }

  return {
    release,
    timestamp: new Date().toISOString(),
    commitHash: report.commitHash,
    summary: report.summary,
    tests,
  };
}

/**
 * Format baseline as release body content.
 */
function formatBaseline(baseline) {
  const json = JSON.stringify(baseline, null, 2);
  return `## Performance Baseline

This release includes a performance baseline for regression testing.

${BASELINE_START_MARKER}
\`\`\`json
${json}
\`\`\`
${BASELINE_END_MARKER}

**Generated:** ${baseline.timestamp}
**Commit:** ${baseline.commitHash || 'unknown'}
**Tests:** ${Object.keys(baseline.tests).length}
`;
}

/**
 * Update release with baseline.
 */
function updateRelease(tag, baselineContent) {
  const { owner, repo } = getRepoInfo();

  // Get current release body
  const releaseJson = exec(`gh api repos/${owner}/${repo}/releases/tags/${tag}`);
  if (!releaseJson) {
    throw new Error(`Release not found: ${tag}`);
  }

  const release = JSON.parse(releaseJson);
  let newBody = release.body || '';

  // Remove existing baseline if present
  const startIdx = newBody.indexOf(BASELINE_START_MARKER);
  const endIdx = newBody.indexOf(BASELINE_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Find the start of the baseline section (including header)
    const sectionStart = newBody.lastIndexOf('## Performance Baseline', startIdx);
    const actualStart = sectionStart !== -1 ? sectionStart : startIdx;
    const actualEnd = endIdx + BASELINE_END_MARKER.length;

    // Also remove any trailing stats after the end marker
    let trailingEnd = actualEnd;
    const trailing = newBody.substring(actualEnd);
    const nextSectionMatch = trailing.match(/\n\n##/);
    if (nextSectionMatch) {
      trailingEnd += nextSectionMatch.index;
    } else {
      // Remove to end of trailing stats
      const statsMatch = trailing.match(/\n\*\*Tests:\*\*[^\n]*/);
      if (statsMatch) {
        trailingEnd += statsMatch.index + statsMatch[0].length;
      }
    }

    newBody = newBody.substring(0, actualStart) + newBody.substring(trailingEnd);
  }

  // Append new baseline
  newBody = newBody.trim() + '\n\n' + baselineContent;

  // Update release using gh CLI
  const tmpFile = `/tmp/release-body-${Date.now()}.md`;
  writeFileSync(tmpFile, newBody);

  try {
    const result = exec(`gh release edit "${tag}" --notes-file "${tmpFile}"`);
    return result !== null;
  } finally {
    unlinkSync(tmpFile);
  }
}

/**
 * Main function.
 */
async function main() {
  const tag = process.argv[2];

  if (!tag) {
    console.error('Usage: node scripts/perf-publish-baseline.mjs <release-tag>');
    process.exit(1);
  }

  console.log(`[perf-publish-baseline] Publishing baseline for release: ${tag}`);

  // Load reports
  const report = loadReports();
  if (!report) {
    console.error('[perf-publish-baseline] No performance reports found in perf-results/');
    process.exit(1);
  }

  console.log(`[perf-publish-baseline] Found ${report.summary.totalTests} test results`);

  // Convert to baseline
  const baseline = reportToBaseline(report, tag);
  console.log(`[perf-publish-baseline] Created baseline with ${Object.keys(baseline.tests).length} tests`);

  // Format and update release
  const baselineContent = formatBaseline(baseline);

  const success = updateRelease(tag, baselineContent);
  if (!success) {
    console.error('[perf-publish-baseline] Failed to update release');
    process.exit(1);
  }

  console.log(`[perf-publish-baseline] Successfully published baseline to release: ${tag}`);
}

main().catch((error) => {
  console.error('[perf-publish-baseline] Error:', error.message);
  process.exit(1);
});
