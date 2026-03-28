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

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles simple YAML: strings, arrays (flow and block), nested objects.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result = {};

  for (const line of yaml.split('\n')) {
    // Skip empty lines and nested keys (e.g., metadata.docs)
    if (!line.trim() || /^\s+/.test(line)) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Flow-style array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''));
    }
    // Quoted string
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    }
    // Plain value
    else if (value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Detect if a skill directory has resource subdirectories (scripts/, references/, assets/).
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

for (const dir of skillDirs) {
  const skillMdPath = path.join(CATALOG_DIR, dir, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const fm = parseFrontmatter(content);

  if (!fm || !fm.name) {
    console.error(`WARNING: ${dir}/SKILL.md has no valid frontmatter or missing 'name'`);
    continue;
  }

  skills.push({
    name: fm.name,
    category: fm.category || dir.replace('frontmcp-', ''),
    description: fm.description || '',
    path: dir,
    targets: fm.targets || ['all'],
    hasResources: hasResources(path.join(CATALOG_DIR, dir)),
    tags: fm.tags || [],
    bundle: fm.bundle || ['full'],
  });
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
