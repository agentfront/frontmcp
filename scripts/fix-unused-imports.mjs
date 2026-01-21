#!/usr/bin/env node
/**
 * Remove unused imports from files changed in the current branch.
 *
 * Usage:
 *   node scripts/fix-unused-imports.mjs [base-branch]
 *
 * Arguments:
 *   base-branch  The branch to compare against (default: auto-detect merge-base with main/master)
 *
 * Examples:
 *   node scripts/fix-unused-imports.mjs           # Compare against main/master
 *   node scripts/fix-unused-imports.mjs main      # Compare against main
 *   node scripts/fix-unused-imports.mjs release/1.0  # Compare against release/1.0
 */

import { execFileSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/** Valid branch name pattern (alphanumeric, hyphens, underscores, slashes, dots) */
const VALID_BRANCH_PATTERN = /^[A-Za-z0-9._\/-]+$/;

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
      console.error(`Error: Invalid branch name "${arg}". Branch names must contain only alphanumeric characters, hyphens, underscores, slashes, and dots.`);
      process.exit(1);
    }
    return arg;
  }

  // Auto-detect: try main, then master
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
 * Get files changed between current branch and base branch.
 * Uses execFileSync with array arguments to prevent command injection.
 * @param {string} baseBranch - The base branch to compare against
 */
function getChangedFiles(baseBranch) {
  console.log(`Comparing against: ${baseBranch}`);

  // Get files that differ between base branch and current HEAD
  // Using execFileSync with array arguments for safety
  const diffOutput = execFileSync(
    'git',
    ['diff', `${baseBranch}...HEAD`, '--name-only', '--diff-filter=ACM'],
    { encoding: 'utf-8' }
  );

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
      execFileSync(
        'npx',
        ['eslint', '--config', tempConfigPath, '--fix', ...files],
        { stdio: 'inherit' }
      );
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
