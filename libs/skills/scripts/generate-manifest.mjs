#!/usr/bin/env node

/**
 * Generate skills-manifest.json from SKILL.md, references/, and examples/ metadata.
 *
 * SKILL.md remains the single source of truth for skill metadata.
 * Example files under examples/<reference-name>/ are the single source of truth
 * for per-example metadata nested under each reference entry.
 *
 * This script reads the catalog directory, parses frontmatter,
 * detects resource directories, resolves reference/example metadata,
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
const VALID_CATEGORIES = ['setup', 'deployment', 'development', 'config', 'testing', 'guides', 'production', 'extensibility'];
const VALID_TARGETS = ['node', 'vercel', 'lambda', 'cloudflare', 'all'];
const VALID_BUNDLES = ['recommended', 'minimal', 'full'];

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles flow-style arrays, quoted strings, plain scalars,
 * block sequences (- item), and nested key:value pairs.
 */
function normalizeScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    if (quote === '"') {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
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
        .map((s) => normalizeScalar(s));
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      // Quoted string
      result[key] = normalizeScalar(value);
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
          items.push(normalizeScalar(sub.slice(2)));
          hasBlock = true;
        } else if (sub.includes(':')) {
          // Nested key:value
          const subColonIdx = sub.indexOf(':');
          const subKey = sub.slice(0, subColonIdx).trim();
          const subVal = normalizeScalar(sub.slice(subColonIdx + 1));
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
function toStringArray(val, fallback, field, errors, dir) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') return [val];
  if (Array.isArray(val) && val.every((item) => typeof item === 'string')) return val;
  errors.push(`${dir}/SKILL.md: ${field} must be a string or string[], got ${typeof val}`);
  return null;
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

/**
 * Extract the first non-empty paragraph after the heading from markdown content.
 */
function extractFirstParagraph(body) {
  const lines = body.split(/\r?\n/);
  let foundHeading = false;
  const paragraphLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundHeading && trimmed.startsWith('#')) {
      foundHeading = true;
      continue;
    }
    if (foundHeading) {
      if (trimmed === '') {
        if (paragraphLines.length > 0) break;
        continue;
      }
      if (trimmed.startsWith('#') || trimmed.startsWith('|') || trimmed.startsWith('-')) break;
      paragraphLines.push(trimmed);
    }
  }

  return paragraphLines.join(' ').slice(0, 200) || '';
}

function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

function toRequiredStringArray(val, field, errors, filePath) {
  if (!Array.isArray(val)) {
    errors.push(`${filePath}: ${field} must be a non-empty string[]`);
    return [];
  }
  const values = val
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0 || values.length !== val.length) {
    errors.push(`${filePath}: ${field} must be a non-empty string[]`);
  }
  return values;
}

function scanExamples(skillDir, skillName, referenceName, errors) {
  const examplesDir = path.join(skillDir, 'examples', referenceName);
  if (!fs.existsSync(examplesDir)) return [];

  const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.md')).sort();

  return files.map((file) => {
    const examplePath = path.join(examplesDir, file);
    const content = fs.readFileSync(examplePath, 'utf-8');
    const fm = parseFrontmatter(content);
    const filenameWithoutExt = file.replace(/\.md$/, '');
    const filePath = `${skillName}/examples/${referenceName}/${file}`;

    if (!fm) {
      errors.push(`${filePath}: missing frontmatter`);
      return {
        name: filenameWithoutExt,
        description: extractFirstParagraph(stripFrontmatter(content)),
        level: 'basic',
        tags: [],
        features: [],
      };
    }

    const name = typeof fm.name === 'string' && fm.name ? fm.name : filenameWithoutExt;
    const reference = typeof fm.reference === 'string' ? fm.reference : '';
    const description =
      typeof fm.description === 'string' && fm.description
        ? fm.description
        : extractFirstParagraph(stripFrontmatter(content));
    const level = typeof fm.level === 'string' ? fm.level : '';
    const tags = toRequiredStringArray(fm.tags, 'tags', errors, filePath);
    const features = toRequiredStringArray(fm.features, 'features', errors, filePath);

    if (name !== filenameWithoutExt) {
      errors.push(`${filePath}: frontmatter "name" must match filename "${filenameWithoutExt}"`);
    }
    if (reference !== referenceName) {
      errors.push(`${filePath}: frontmatter "reference" is "${reference}" but expected "${referenceName}"`);
    }
    if (!description) {
      errors.push(`${filePath}: missing non-empty "description"`);
    }
    if (!['basic', 'intermediate', 'advanced'].includes(level)) {
      errors.push(`${filePath}: invalid "level" value "${level}"`);
    }

    return {
      name,
      description,
      level,
      tags,
      features,
    };
  });
}

/**
 * Scan the references/ directory for .md files and extract metadata.
 * Uses frontmatter if present, otherwise falls back to heading/paragraph parsing.
 */
function scanReferences(skillDir, skillName, errors) {
  const refsDir = path.join(skillDir, 'references');
  if (!fs.existsSync(refsDir)) return undefined;

  const files = fs.readdirSync(refsDir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) return undefined;

  return files.map((file) => {
    const content = fs.readFileSync(path.join(refsDir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    const filenameWithoutExt = file.replace(/\.md$/, '');

    let name = filenameWithoutExt;
    let description = '';

    if (fm) {
      if (typeof fm.name === 'string' && fm.name) name = fm.name;
      if (typeof fm.description === 'string' && fm.description) description = fm.description;
    }

    // Fallback: extract description from first paragraph if not in frontmatter
    if (!description) {
      description = extractFirstParagraph(stripFrontmatter(content));
    }

    return {
      name,
      description,
      examples: scanExamples(skillDir, skillName, name, errors),
    };
  });
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

  if (!fm || typeof fm.name !== 'string' || !fm.name) {
    errors.push(`${dir}/SKILL.md: missing valid frontmatter or 'name' must be a non-empty string`);
    continue;
  }

  if (fm.description != null && typeof fm.description !== 'string') {
    errors.push(`${dir}/SKILL.md: description must be a string`);
    continue;
  }

  const category = fm.category || dir.replace('frontmcp-', '');
  const targets = toStringArray(fm.targets, ['all'], 'targets', errors, dir);
  const tags = toStringArray(fm.tags, [], 'tags', errors, dir);
  const bundle = toStringArray(fm.bundle, ['full'], 'bundle', errors, dir);

  if (!targets || !tags || !bundle) continue;

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

  const skillDirPath = path.join(CATALOG_DIR, dir);
  const refs = scanReferences(skillDirPath, dir, errors);

  const entry = {
    name: fm.name,
    category,
    description: fm.description || '',
    path: dir,
    targets,
    hasResources: hasResources(skillDirPath),
    tags,
    bundle,
  };

  if (refs && refs.length > 0) {
    entry.references = refs;
  }

  skills.push(entry);
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
