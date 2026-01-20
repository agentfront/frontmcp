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

import { execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// Get the base branch to compare against
function getBaseBranch() {
  const arg = process.argv[2];
  if (arg) {
    return arg;
  }

  // Auto-detect: try main, then master
  try {
    execSync('git rev-parse --verify main', { stdio: 'ignore' });
    return 'main';
  } catch {
    try {
      execSync('git rev-parse --verify master', { stdio: 'ignore' });
      return 'master';
    } catch {
      console.error('Error: Could not find main or master branch. Please specify a base branch.');
      process.exit(1);
    }
  }
}

// Get files changed between current branch and base branch
function getChangedFiles(baseBranch) {
  console.log(`Comparing against: ${baseBranch}`);

  // Get files that differ between base branch and current HEAD
  const diffOutput = execSync(`git diff ${baseBranch}...HEAD --name-only --diff-filter=ACM`, { encoding: 'utf-8' });

  const files = diffOutput
    .split('\n')
    .filter((f) => f.trim())
    .filter((f) => /\.(ts|tsx|js|jsx|mts|mjs)$/.test(f))
    .filter((f) => existsSync(f));

  return files;
}

// Run ESLint with unused-imports fix on specific files
function fixUnusedImports(files) {
  if (files.length === 0) {
    console.log('No changed TypeScript/JavaScript files to process.');
    return;
  }

  console.log(`Processing ${files.length} file(s)...`);

  // Create a temporary ESLint flat config file for unused imports
  const tempConfigPath = join(process.cwd(), 'eslint.fix-imports.config.mjs');
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

    execSync(`npx eslint --config ${tempConfigPath} --fix ${files.join(' ')}`, { stdio: 'inherit' });
    console.log('Done! Unused imports removed.');
  } catch (error) {
    // ESLint exits with code 1 if it fixes files, which is expected
    console.log('Done processing files.');
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
