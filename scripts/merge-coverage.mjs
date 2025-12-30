#!/usr/bin/env node
/**
 * Coverage Merge Script
 *
 * Merges coverage reports from unit tests and E2E tests into a unified report.
 *
 * Usage:
 *   node scripts/merge-coverage.mjs [options]
 *
 * Options:
 *   --unit-only    Only merge unit test coverage
 *   --e2e-only     Only merge E2E test coverage
 *   --library=X    Only merge coverage for a specific library
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COVERAGE_DIR = join(ROOT, 'coverage');
const NYC_OUTPUT = join(ROOT, '.nyc_output');
const MERGED_DIR = join(COVERAGE_DIR, 'merged');

// Parse arguments
const args = process.argv.slice(2);
const unitOnly = args.includes('--unit-only');
const e2eOnly = args.includes('--e2e-only');
const libraryArg = args.find((a) => a.startsWith('--library='));
const targetLibrary = libraryArg?.split('=')[1];

console.log('Coverage Merge Script');
console.log('=====================\n');

// Clean previous merge output
if (existsSync(NYC_OUTPUT)) {
  rmSync(NYC_OUTPUT, { recursive: true });
}
mkdirSync(NYC_OUTPUT, { recursive: true });

if (existsSync(MERGED_DIR)) {
  rmSync(MERGED_DIR, { recursive: true });
}
mkdirSync(MERGED_DIR, { recursive: true });

// Collect all coverage-final.json files
const coverageFiles = [];

// Unit test coverage
if (!e2eOnly) {
  const unitDir = join(COVERAGE_DIR, 'unit');
  if (existsSync(unitDir)) {
    console.log('Collecting unit test coverage:');
    for (const lib of readdirSync(unitDir)) {
      if (targetLibrary && lib !== targetLibrary) continue;
      const coverageFile = join(unitDir, lib, 'coverage-final.json');
      if (existsSync(coverageFile)) {
        coverageFiles.push({ path: coverageFile, name: `unit-${lib}` });
        console.log(`  - ${lib}`);
      }
    }
  } else {
    console.log('No unit test coverage found at coverage/unit/');
  }
}

// E2E test coverage
if (!unitOnly) {
  const e2eDir = join(COVERAGE_DIR, 'e2e');
  if (existsSync(e2eDir)) {
    console.log('\nCollecting E2E test coverage:');
    for (const app of readdirSync(e2eDir)) {
      const coverageFile = join(e2eDir, app, 'coverage-final.json');
      if (existsSync(coverageFile)) {
        coverageFiles.push({ path: coverageFile, name: `e2e-${app}` });
        console.log(`  - ${app}`);
      }
    }
  } else {
    console.log('No E2E test coverage found at coverage/e2e/');
  }
}

if (coverageFiles.length === 0) {
  console.log('\nNo coverage files found. Run tests with --coverage first:');
  console.log('  yarn test:unit:coverage');
  console.log('  yarn test:e2e:coverage');
  process.exit(1);
}

console.log(`\nMerging ${coverageFiles.length} coverage files...`);

// Copy all coverage files to .nyc_output with unique names
coverageFiles.forEach(({ path, name }) => {
  const targetFile = join(NYC_OUTPUT, `${name}.json`);
  copyFileSync(path, targetFile);
});

try {
  // Merge coverage using nyc
  execSync(`npx nyc merge "${NYC_OUTPUT}" "${join(MERGED_DIR, 'coverage-final.json')}"`, {
    cwd: ROOT,
    stdio: 'pipe',
  });

  // Generate reports from merged coverage
  execSync(
    `npx nyc report --temp-dir="${MERGED_DIR}" --report-dir="${MERGED_DIR}" --reporter=lcov --reporter=html --reporter=text-summary`,
    {
      cwd: ROOT,
      stdio: 'inherit',
    }
  );

  console.log('\nCoverage reports generated successfully:');
  console.log(`  HTML:  ${MERGED_DIR}/index.html`);
  console.log(`  LCOV:  ${MERGED_DIR}/lcov.info`);
  console.log(`  JSON:  ${MERGED_DIR}/coverage-final.json`);
} catch (error) {
  console.error('\nError merging coverage:', error.message);
  process.exit(1);
} finally {
  // Cleanup .nyc_output
  if (existsSync(NYC_OUTPUT)) {
    rmSync(NYC_OUTPUT, { recursive: true, force: true });
  }
}
