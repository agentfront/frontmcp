#!/usr/bin/env node
/**
 * Per-Library Coverage Status
 *
 * Reads Istanbul coverage JSON files and prints a per-library breakdown table.
 *
 * Usage:
 *   node scripts/coverage-status.mjs [options]
 *
 * Options:
 *   --unit-only   Only read unit test coverage
 *   --merged      Read merged coverage (default, falls back to unit if unavailable)
 *   --json        Output JSON for CI consumption
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COVERAGE_DIR = join(ROOT, 'coverage');

// Parse arguments
const args = process.argv.slice(2);
const unitOnly = args.includes('--unit-only');
const mergedMode = args.includes('--merged') || !unitOnly;
const jsonOutput = args.includes('--json');
const noColor = !!process.env.NO_COLOR;

// ANSI color codes
const colors = {
  reset: noColor ? '' : '\x1b[0m',
  green: noColor ? '' : '\x1b[32m',
  yellow: noColor ? '' : '\x1b[33m',
  red: noColor ? '' : '\x1b[31m',
  bold: noColor ? '' : '\x1b[1m',
  dim: noColor ? '' : '\x1b[2m',
};

function colorize(pct) {
  if (pct >= 95) return colors.green;
  if (pct >= 80) return colors.yellow;
  return colors.red;
}

function fmtPct(pct) {
  return pct.toFixed(1).padStart(5) + '%';
}

/**
 * Determine the coverage source label based on which directories have data for a library.
 */
function getSourceLabel(lib) {
  const hasUnit = existsSync(join(COVERAGE_DIR, 'unit', lib, 'coverage-final.json'));

  // Check if any e2e coverage file references this lib
  let hasE2e = false;
  const e2eDir = join(COVERAGE_DIR, 'e2e');
  if (existsSync(e2eDir)) {
    for (const app of readdirSync(e2eDir)) {
      const e2eCovFile = join(e2eDir, app, 'coverage-final.json');
      if (existsSync(e2eCovFile)) {
        try {
          const raw = readFileSync(e2eCovFile, 'utf8');
          if (raw.includes(`/libs/${lib}/src/`) || raw.includes(`/plugins/${lib}/src/`)) {
            hasE2e = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  if (hasUnit && hasE2e) return 'unit+e2e';
  if (hasE2e) return 'e2e';
  return 'unit';
}

/**
 * Load coverage data. Returns the parsed coverage-final.json object.
 */
function loadCoverage() {
  // Try merged first (unless unit-only)
  if (mergedMode && !unitOnly) {
    const mergedFile = join(COVERAGE_DIR, 'merged', 'coverage-final.json');
    if (existsSync(mergedFile)) {
      return { data: JSON.parse(readFileSync(mergedFile, 'utf8')), source: 'merged' };
    }
  }

  // Fall back to individual unit coverage files
  const unitDir = join(COVERAGE_DIR, 'unit');
  if (!existsSync(unitDir)) {
    return { data: null, source: null };
  }

  const merged = {};
  for (const lib of readdirSync(unitDir)) {
    const coverageFile = join(unitDir, lib, 'coverage-final.json');
    if (existsSync(coverageFile)) {
      const data = JSON.parse(readFileSync(coverageFile, 'utf8'));
      Object.assign(merged, data);
    }
  }

  return { data: Object.keys(merged).length > 0 ? merged : null, source: 'unit' };
}

/**
 * Group coverage entries by library name.
 */
function groupByLibrary(coverageData) {
  const libs = {};
  const libRegex = /\/libs\/([^/]+)\/src\//;
  const pluginRegex = /\/plugins\/([^/]+)\/src\//;

  for (const [filePath, entry] of Object.entries(coverageData)) {
    const match = filePath.match(libRegex) || filePath.match(pluginRegex);
    if (!match) continue;

    const libName = match[1];
    if (!libs[libName]) libs[libName] = [];
    libs[libName].push(entry);
  }

  return libs;
}

/**
 * Compute coverage metrics for a list of Istanbul file entries.
 */
function computeMetrics(entries) {
  let totalStmts = 0;
  let coveredStmts = 0;
  let totalFuncs = 0;
  let coveredFuncs = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalLines = 0;
  let coveredLines = 0;

  for (const entry of entries) {
    // Statements
    const stmtCounts = Object.values(entry.s || {});
    totalStmts += stmtCounts.length;
    coveredStmts += stmtCounts.filter((c) => c > 0).length;

    // Functions
    const funcCounts = Object.values(entry.f || {});
    totalFuncs += funcCounts.length;
    coveredFuncs += funcCounts.filter((c) => c > 0).length;

    // Branches (each key has an array of counts)
    for (const branchCounts of Object.values(entry.b || {})) {
      totalBranches += branchCounts.length;
      coveredBranches += branchCounts.filter((c) => c > 0).length;
    }

    // Lines: de-duplicate statements by start line
    const stmtMap = entry.statementMap || {};
    const lineSet = new Set();
    const coveredLineSet = new Set();
    for (const [key, loc] of Object.entries(stmtMap)) {
      const line = loc.start.line;
      lineSet.add(line);
      if ((entry.s || {})[key] > 0) {
        coveredLineSet.add(line);
      }
    }
    totalLines += lineSet.size;
    coveredLines += coveredLineSet.size;
  }

  return {
    stmts: totalStmts === 0 ? 100 : (coveredStmts / totalStmts) * 100,
    branches: totalBranches === 0 ? 100 : (coveredBranches / totalBranches) * 100,
    funcs: totalFuncs === 0 ? 100 : (coveredFuncs / totalFuncs) * 100,
    lines: totalLines === 0 ? 100 : (coveredLines / totalLines) * 100,
    files: entries.length,
    totalStmts,
    coveredStmts,
    totalBranches,
    coveredBranches,
    totalFuncs,
    coveredFuncs,
    totalLines,
    coveredLines,
  };
}

// Main
const { data, source } = loadCoverage();

if (!data) {
  console.error('No coverage data found. Run tests with --coverage first:');
  console.error('  yarn test:unit:coverage');
  console.error('  yarn coverage:all');
  process.exit(1);
}

const libGroups = groupByLibrary(data);
const libNames = Object.keys(libGroups).sort();

if (libNames.length === 0) {
  console.error('No library coverage data found in coverage files.');
  process.exit(1);
}

// Compute per-library metrics
const results = [];
for (const lib of libNames) {
  const metrics = computeMetrics(libGroups[lib]);
  const sourceLabel = source === 'merged' ? getSourceLabel(lib) : 'unit';
  results.push({ library: lib, ...metrics, source: sourceLabel });
}

// Compute totals
const allEntries = libNames.flatMap((lib) => libGroups[lib]);
const totals = computeMetrics(allEntries);

// JSON output mode
if (jsonOutput) {
  const output = {
    libraries: results.map((r) => ({
      library: r.library,
      statements: +r.stmts.toFixed(2),
      branches: +r.branches.toFixed(2),
      functions: +r.funcs.toFixed(2),
      lines: +r.lines.toFixed(2),
      files: r.files,
      source: r.source,
    })),
    totals: {
      statements: +totals.stmts.toFixed(2),
      branches: +totals.branches.toFixed(2),
      functions: +totals.funcs.toFixed(2),
      lines: +totals.lines.toFixed(2),
      files: totals.files,
    },
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// Table output
const COL = {
  lib: 17,
  pct: 10,
  files: 7,
  source: 10,
};

function pad(str, len) {
  return str.padEnd(len);
}

function padNum(str, len) {
  return str.padStart(len);
}

const sep = `${'─'.repeat(COL.lib)}┼${'─'.repeat(COL.pct)}┼${'─'.repeat(COL.pct)}┼${'─'.repeat(COL.pct)}┼${'─'.repeat(COL.pct)}┼${'─'.repeat(COL.files)}┼${'─'.repeat(COL.source)}`;

console.log('');
console.log(`${colors.bold}Coverage Status${colors.reset}`);
console.log('═══════════════');
console.log('');

// Header
console.log(
  `${colors.bold}${pad('Library', COL.lib)}│${pad(' Stmts', COL.pct)}│${pad(' Branch', COL.pct)}│${pad(' Funcs', COL.pct)}│${pad(' Lines', COL.pct)}│${pad(' Files', COL.files)}│${pad(' Source', COL.source)}${colors.reset}`
);
console.log(sep);

// Rows
for (const r of results) {
  const sC = colorize(r.stmts);
  const bC = colorize(r.branches);
  const fC = colorize(r.funcs);
  const lC = colorize(r.lines);

  console.log(
    `${pad(r.library, COL.lib)}│ ${sC}${fmtPct(r.stmts)}${colors.reset}   │ ${bC}${fmtPct(r.branches)}${colors.reset}   │ ${fC}${fmtPct(r.funcs)}${colors.reset}   │ ${lC}${fmtPct(r.lines)}${colors.reset}   │${padNum(String(r.files), COL.files - 1)} │ ${r.source}`
  );
}

// Total row
console.log(sep);
const tSC = colorize(totals.stmts);
const tBC = colorize(totals.branches);
const tFC = colorize(totals.funcs);
const tLC = colorize(totals.lines);

console.log(
  `${colors.bold}${pad('TOTAL', COL.lib)}${colors.reset}│ ${tSC}${fmtPct(totals.stmts)}${colors.reset}   │ ${tBC}${fmtPct(totals.branches)}${colors.reset}   │ ${tFC}${fmtPct(totals.funcs)}${colors.reset}   │ ${tLC}${fmtPct(totals.lines)}${colors.reset}   │${padNum(String(totals.files), COL.files - 1)} │`
);

console.log('');
console.log(`${colors.dim}Source: ${source === 'merged' ? 'merged (unit+e2e)' : 'unit only'}${colors.reset}`);
console.log('');
