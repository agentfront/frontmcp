#!/usr/bin/env node

/**
 * Generate skills-manifest.json from SKILL.md frontmatter files.
 *
 * SKILL.md is the single source of truth for skill metadata.
 * This script reads all SKILL.md files in the catalog directory,
 * parses their YAML frontmatter, detects resource directories,
 * and writes the manifest JSON.
 *
 * Runs automatically as part of `nx build skills` (generate-manifest target).
 *
 * Usage: node libs/skills/scripts/generate-manifest.mjs [--check]
 *   --check  Verify manifest is up-to-date without writing (exits 1 if stale)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');
const MANIFEST_PATH = path.join(CATALOG_DIR, 'skills-manifest.json');

// Allow-lists from libs/skills/src/manifest.ts
const VALID_CATEGORIES = ['setup', 'deployment', 'development', 'config', 'testing', 'guides', 'production'];
const VALID_TARGETS = ['node', 'vercel', 'lambda', 'cloudflare', 'all'];
const VALID_BUNDLES = ['recommended', 'minimal', 'full'];

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles flow-style arrays, quoted strings, plain scalars,
 * block sequences (- item), and nested key:value pairs.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Skip indented lines that aren't part of a block sequence we're collecting
    if (/^\s+/.test(line) && !line.trim().startsWith('-')) {
      i++;
      continue;
    }

    // Only process top-level keys (no leading whitespace)
    if (/^\s/.test(line)) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      // Flow-style array: [a, b, c]
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''));
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      // Quoted string
      result[key] = value.slice(1, -1);
    } else if (value === '' || value === undefined) {
      // Empty value — lookahead for block sequence or nested object
      const items = [];
      const nested = {};
      let hasBlock = false;
      let j = i + 1;

      while (j < lines.length && /^\s+/.test(lines[j])) {
        const sub = lines[j].trim();
        if (sub.startsWith('- ')) {
          // Block sequence item
          items.push(sub.slice(2).trim().replace(/^["']|["']$/g, ''));
          hasBlock = true;
        } else if (sub.includes(':')) {
          // Nested key:value
          const subColonIdx = sub.indexOf(':');
          const subKey = sub.slice(0, subColonIdx).trim();
          const subVal = sub.slice(subColonIdx + 1).trim().replace(/^["']|["']$/g, '');
          nested[subKey] = subVal;
          hasBlock = true;
        }
        j++;
      }

      if (items.length > 0) {
        result[key] = items;
      } else if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }

      if (hasBlock) {
        i = j;
        continue;
      }
    } else if (value) {
      // Plain scalar
      result[key] = value;
    }

    i++;
  }

  return result;
}

/**
 * Coerce a value into a string array. Handles string, array, or undefined.
 */
function toStringArray(val, fallback) {
  if (!val) return fallback;
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

/**
 * Validate array entries against an allow-list.
 * Returns invalid entries or empty array if all valid.
 */
function validateAgainst(values, allowList) {
  return values.filter((v) => !allowList.includes(v));
}

/**
 * Detect if a skill directory has resource subdirectories.
 */
function hasResources(skillDir) {
  return (
    fs.existsSync(path.join(skillDir, 'scripts')) ||
    fs.existsSync(path.join(skillDir, 'references')) ||
    fs.existsSync(path.join(skillDir, 'assets'))
  );
}

// --- Main ---

const checkMode = process.argv.includes('--check');

const skillDirs = fs
  .readdirSync(CATALOG_DIR)
  .filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'SKILL.md'));
  })
  .sort();

const skills = [];
const errors = [];

for (const dir of skillDirs) {
  const skillMdPath = path.join(CATALOG_DIR, dir, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const fm = parseFrontmatter(content);

  if (!fm || !fm.name) {
    errors.push(`${dir}/SKILL.md: missing valid frontmatter or 'name' field`);
    continue;
  }

  const category = fm.category || dir.replace('frontmcp-', '');
  const targets = toStringArray(fm.targets, ['all']);
  const tags = toStringArray(fm.tags, []);
  const bundle = toStringArray(fm.bundle, ['full']);

  // Validate against allow-lists
  if (!VALID_CATEGORIES.includes(category)) {
    errors.push(`${dir}/SKILL.md: invalid category '${category}' (valid: ${VALID_CATEGORIES.join(', ')})`);
  }

  const badTargets = validateAgainst(targets, VALID_TARGETS);
  if (badTargets.length > 0) {
    errors.push(`${dir}/SKILL.md: invalid targets [${badTargets.join(', ')}] (valid: ${VALID_TARGETS.join(', ')})`);
  }

  const badBundles = validateAgainst(bundle, VALID_BUNDLES);
  if (badBundles.length > 0) {
    errors.push(`${dir}/SKILL.md: invalid bundle [${badBundles.join(', ')}] (valid: ${VALID_BUNDLES.join(', ')})`);
  }

  skills.push({
    name: fm.name,
    category,
    description: fm.description || '',
    path: dir,
    targets,
    hasResources: hasResources(path.join(CATALOG_DIR, dir)),
    tags,
    bundle,
  });
}

if (errors.length > 0) {
  for (const err of errors) console.error(`ERROR: ${err}`);
  process.exit(1);
}

const manifest = { version: 1, skills };
const output = JSON.stringify(manifest, null, 2) + '\n';

if (checkMode) {
  const existing = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf-8') : '';
  if (existing === output) {
    console.log('skills-manifest.json is up-to-date.');
    process.exit(0);
  } else {
    console.error('skills-manifest.json is STALE. Run: node libs/skills/scripts/generate-manifest.mjs');
    process.exit(1);
  }
} else {
  fs.writeFileSync(MANIFEST_PATH, output);
  console.log(`Generated skills-manifest.json with ${skills.length} skills.`);
}
