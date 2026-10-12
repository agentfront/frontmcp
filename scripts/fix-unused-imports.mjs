#!/usr/bin/env node
/**
 * Remove unused imports from files changed in the current branch.
 *
 * Usage:
 *   node scripts/fix-unused-imports.mjs [base-branch]
 *
 * Arguments:
 *   base-branch  The branch to compare against (default: the pull request's base, see detectBaseBranch)
 *
 * Examples:
 *   node scripts/fix-unused-imports.mjs           # Compare against the pull request's base
 *   node scripts/fix-unused-imports.mjs main      # Compare against main
 *   node scripts/fix-unused-imports.mjs release/1.0  # Compare against release/1.0
 */
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Valid branch name pattern (alphanumeric, hyphens, underscores, slashes, dots) */
const VALID_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * Validate a branch name to prevent injection attacks.
 * @param {string} branch - The branch name to validate
 * @returns {boolean} True if the branch name is valid
 */
function isValidBranchName(branch) {
  if (!branch || typeof branch !== 'string') {
    return false;
  }
  if (branch.length > 255) {
    return false;
  }
  // Prevent path traversal and other injection patterns
  if (branch.includes('..') || branch.startsWith('-')) {
    return false;
  }
  return VALID_BRANCH_PATTERN.test(branch);
}

/**
 * Get the base branch to compare against.
 * Uses execFileSync with array arguments to prevent command injection.
 */
function getBaseBranch() {
  const arg = process.argv[2];
  if (arg) {
    if (!isValidBranchName(arg)) {
      console.error(
        `Error: Invalid branch name "${arg}". Branch names must contain only alphanumeric characters, hyphens, underscores, slashes, and dots.`,
      );
      process.exit(1);
    }
    return arg;
  }

  const detected = detectBaseBranch();
  if (detected) {
    return detected;
  }

  try {
    execFileSync('git', ['rev-parse', '--verify', 'main'], { stdio: 'ignore' });
    return 'main';
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--verify', 'master'], { stdio: 'ignore' });
      return 'master';
    } catch {
      console.error('Error: Could not find main or master branch. Please specify a base branch.');
      process.exit(1);
    }
  }
}

/**
 * The branch a pull request from HEAD targets: `GITHUB_BASE_REF` in CI, else the remote `main`, `master`,
 * `release/*` or `next/*` branch with the fewest commits on HEAD that it doesn't have. A local `main` can
 * be stale, and a branch from `release/*` has every commit since the release line left `main`.
 */
function detectBaseBranch() {
  const pullRequestBase = process.env.GITHUB_BASE_REF;
  if (pullRequestBase && isValidBranchName(pullRequestBase)) {
    return `origin/${pullRequestBase}`;
  }

  const candidates = execFileSync(
    'git',
    [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/remotes/origin/main',
      'refs/remotes/origin/master',
      'refs/remotes/origin/release',
      'refs/remotes/origin/next',
    ],
    { encoding: 'utf-8' },
  )
    .split('\n')
    .filter(Boolean);

  let nearest;
  let fewestCommitsAhead = Infinity;
  for (const candidate of candidates) {
    const commitsAhead = Number(
      execFileSync('git', ['rev-list', '--count', `${candidate}..HEAD`], { encoding: 'utf-8' }).trim(),
    );
    if (commitsAhead < fewestCommitsAhead) {
      nearest = candidate;
      fewestCommitsAhead = commitsAhead;
    }
  }
  return nearest;
}

/**
 * Get files changed between current branch and base branch.
 * Uses execFileSync with array arguments to prevent command injection.
 * @param {string} baseBranch - The base branch to compare against
 */
function getChangedFiles(baseBranch) {
  console.log(`Comparing against: ${baseBranch}`);

  // Get files that differ between base branch and current HEAD
  // Using execFileSync with array arguments for safety
  const diffOutput = execFileSync('git', ['diff', `${baseBranch}...HEAD`, '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf-8',
  });

  const files = diffOutput
    .split('\n')
    .filter((f) => f.trim())
    .filter((f) => /\.(ts|tsx|js|jsx|mts|mjs)$/.test(f))
    .filter((f) => existsSync(f));

  return files;
}

/**
 * Run ESLint with unused-imports fix on specific files.
 * @param {string[]} files - Array of file paths to process
 */
function fixUnusedImports(files) {
  if (files.length === 0) {
    console.log('No changed TypeScript/JavaScript files to process.');
    return;
  }

  console.log(`Processing ${files.length} file(s)...`);

  // Create a temporary ESLint flat config file for unused imports
  // Use process.pid to create unique filename and avoid parallel run collisions
  const tempConfigPath = join(process.cwd(), `eslint.fix-imports.${process.pid}.config.mjs`);
  const configContent = `
import unusedImports from 'eslint-plugin-unused-imports';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
    },
  },
];
`;

  try {
    writeFileSync(tempConfigPath, configContent);

    // Use execFileSync with array arguments to prevent shell injection
    // ESLint exits with code 1 if it finds (and fixes) issues, which is expected
    try {
      execFileSync('npx', ['eslint', '--config', tempConfigPath, '--fix', ...files], { stdio: 'inherit' });
      console.log('Done! Unused imports removed.');
    } catch (error) {
      // ESLint exit code 1 = linting errors remain after --fix (some issues couldn't be auto-fixed)
      // This still means fixes were applied for what was auto-fixable
      // ESLint exit code 2 = configuration or fatal error - this is failure
      if (error.status === 1) {
        console.log('Done processing. Some linting issues may remain (check output above).');
      } else {
        console.error('ESLint encountered an error:', error.message || 'Unknown error');
        throw error;
      }
    }
  } finally {
    // Clean up temp config
    try {
      unlinkSync(tempConfigPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

const baseBranch = getBaseBranch();
const files = getChangedFiles(baseBranch);
fixUnusedImports(files);
