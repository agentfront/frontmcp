#!/usr/bin/env node
/**
 * Normalize the version line of every publishable workspace package.
 *
 * Sets `version` on each `libs/<x>/package.json` and `plugins/<x>/package.json`
 * to a single target version, and rewrites every internal `@frontmcp/*` entry in
 * `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`
 * to that same exact version.
 *
 * Why this exists
 * ---------------
 * Internal deps are pinned to exact versions (see create-release-branch.yml — caret
 * ranges do not satisfy prereleases like `1.1.0-beta.1`, which breaks publishing).
 * Yarn records those exact pins inside yarn.lock, so any package.json whose version
 * line disagrees with its siblings makes `yarn install --immutable` fail with YN0028
 * — and, worse, makes Yarn resolve the mismatched siblings from the npm registry
 * instead of linking the local workspace.
 *
 * That is exactly what a cherry-pick from a release branch does: it drags the release
 * line's bumped `version` fields and pins into a branch that is still on its own line.
 *
 * Usage
 * -----
 *   node scripts/normalize-internal-versions.mjs             # infer target, rewrite
 *   node scripts/normalize-internal-versions.mjs 1.4.0       # explicit target, rewrite
 *   node scripts/normalize-internal-versions.mjs --check     # infer target, report only
 *   node scripts/normalize-internal-versions.mjs 1.4.0 --check
 *
 * `--check` exits non-zero when anything would change, so CI can gate on it.
 *
 * With no explicit target, the version shared by the largest number of workspace
 * packages wins. That makes the script self-healing: a cherry-pick that contaminates
 * a handful of manifests is corrected back to whatever the branch as a whole is on.
 */
import fs from 'node:fs';
import path from 'node:path';

const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const WORKSPACE_DIRS = ['libs', 'plugins'];
const INTERNAL_SCOPE = '@frontmcp/';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const explicitVersion = argv.find((a) => !a.startsWith('--'));

if (explicitVersion && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(explicitVersion)) {
  console.error(`Invalid version: ${explicitVersion}. Expected semver, e.g. 1.4.0 or 1.5.0-beta.1`);
  process.exit(1);
}

/** @returns {{file: string, raw: string, pkg: Record<string, any>}[]} */
function collectManifests() {
  const found = [];
  for (const dir of WORKSPACE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, entry, 'package.json');
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      found.push({ file, raw, pkg: JSON.parse(raw) });
    }
  }
  return found;
}

/** Version held by the most workspace packages; ties are ambiguous and rejected. */
function inferTargetVersion(manifests) {
  const tally = new Map();
  for (const { pkg } of manifests) {
    if (typeof pkg.version === 'string') {
      tally.set(pkg.version, (tally.get(pkg.version) ?? 0) + 1);
    }
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    console.error('Could not infer a target version: no workspace package declares one.');
    process.exit(1);
  }
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    console.error(
      `Could not infer a target version: "${ranked[0][0]}" and "${ranked[1][0]}" are equally common ` +
        `(${ranked[0][1]} packages each). Pass the intended version explicitly.`,
    );
    process.exit(1);
  }
  return ranked[0][0];
}

const manifests = collectManifests();
if (manifests.length === 0) {
  console.error(`No workspace manifests found under ${WORKSPACE_DIRS.join('/, ')}/.`);
  process.exit(1);
}

const target = explicitVersion ?? inferTargetVersion(manifests);
console.log(
  `Target version: ${target}${explicitVersion ? '' : ' (inferred — most common across workspace packages)'}\n`,
);

const drifted = [];

for (const { file, raw, pkg } of manifests) {
  /** @type {string[]} */
  const changes = [];

  if (pkg.version !== target) {
    changes.push(`version: ${pkg.version} -> ${target}`);
    pkg.version = target;
  }

  for (const section of SECTIONS) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      // Only internal packages are pinned this way. External deps (and any
      // `workspace:`/`file:` protocol entry, should one ever appear) are left alone.
      if (!name.startsWith(INTERNAL_SCOPE)) continue;
      if (typeof deps[name] !== 'string' || deps[name].includes(':')) continue;
      if (deps[name] === target) continue;
      changes.push(`${section}.${name}: ${deps[name]} -> ${target}`);
      deps[name] = target;
    }
  }

  if (changes.length === 0) continue;

  drifted.push({ file, changes });
  console.log(`${file}`);
  for (const c of changes) console.log(`  ${c}`);

  if (!checkOnly) {
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  }
}

if (drifted.length === 0) {
  console.log(`All ${manifests.length} workspace package(s) already on v${target}.`);
  process.exit(0);
}

const changeCount = drifted.reduce((n, d) => n + d.changes.length, 0);

if (checkOnly) {
  console.error(
    `\n✗ ${changeCount} version pin(s) across ${drifted.length} package(s) do not match v${target}.\n` +
      `  Run: node scripts/normalize-internal-versions.mjs && yarn install --mode=update-lockfile`,
  );
  process.exit(1);
}

console.log(`\n✓ Normalized ${changeCount} pin(s) across ${drifted.length} package(s) to v${target}.`);
console.log('  Next: yarn install --mode=update-lockfile');
