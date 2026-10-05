#!/usr/bin/env node

/**
 * Generate skills-manifest.json from SKILL.md, references/, examples/, and rules/ metadata.
 *
 * SKILL.md remains the single source of truth for skill metadata.
 * Router-layout skills (the default) group examples under examples/<reference-name>/,
 * nested under each reference entry. Component-layout skills (`layout: component`)
 * keep examples flat under examples/ and DO/DON'T rules under rules/, both listed
 * at the top level of the skill entry. A component skill's manifest description is
 * the first paragraph of its SKILL.md description, the listing-friendly summary
 * before the trigger lists.
 *
 * This script reads the catalog directory, parses frontmatter,
 * detects resource directories, resolves reference/example/rule metadata,
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

import * as prettier from 'prettier';
import { parse as parseYaml } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');
const MANIFEST_PATH = path.join(CATALOG_DIR, 'skills-manifest.json');

// Allow-lists from libs/skills/src/manifest.ts — keep in lockstep with VALID_* exports there.
const VALID_CATEGORIES = [
  'setup',
  'deployment',
  'development',
  'development/create',
  'config',
  'testing',
  'guides',
  'production',
  'extensibility',
  'observability',
];
const VALID_TARGETS = ['node', 'vercel', 'lambda', 'cloudflare', 'all'];
const VALID_LAYOUTS = ['router', 'component'];
const VALID_BUNDLES = ['recommended', 'minimal', 'full'];
const VALID_EXAMPLE_LEVELS = ['basic', 'intermediate', 'advanced'];
const VALID_RULE_SEVERITIES = ['required', 'recommended'];

/**
 * Parse the YAML frontmatter of a markdown file, as the SDK's SKILL.md parser does.
 * Returns null when the file has no frontmatter block, or it is not a valid YAML mapping.
 */
function parseFrontmatter(content, filePath, errors) {
  const match = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const data = parseYaml(match[1]);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (error) {
    errors.push(`${filePath}: invalid YAML frontmatter: ${error.message.split('\n')[0]}`);
    return null;
  }
}

/**
 * The first paragraph of a multi-paragraph description, on one line.
 */
function firstParagraph(text) {
  const [paragraph] = text.trim().split(/\r?\n\s*\r?\n/);
  return paragraph.split(/\s+/).join(' ');
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

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

/**
 * Read the examples of one examples directory. `referenceName` is the reference a
 * router-layout example must declare; component-layout examples declare none.
 */
function scanExamples(examplesDir, displayDir, referenceName, errors) {
  return listMarkdownFiles(examplesDir).map((file) => {
    const examplePath = path.join(examplesDir, file);
    const content = fs.readFileSync(examplePath, 'utf-8');
    const filePath = `${displayDir}/${file}`;
    const fm = parseFrontmatter(content, filePath, errors);
    const filenameWithoutExt = file.replace(/\.md$/, '');

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
    if (referenceName !== undefined && reference !== referenceName) {
      errors.push(`${filePath}: frontmatter "reference" is "${reference}" but expected "${referenceName}"`);
    }
    if (!description) {
      errors.push(`${filePath}: missing non-empty "description"`);
    }
    if (!VALID_EXAMPLE_LEVELS.includes(level)) {
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
 * Router-layout references carry their examples; component-layout ones do not.
 */
function scanReferences(skillDir, skillName, layout, errors) {
  const refsDir = path.join(skillDir, 'references');
  const files = listMarkdownFiles(refsDir);
  if (files.length === 0) return undefined;

  return files.map((file) => {
    const content = fs.readFileSync(path.join(refsDir, file), 'utf-8');
    const fm = parseFrontmatter(content, `${skillName}/references/${file}`, errors);
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

    if (layout === 'component') return { name, description };
    return {
      name,
      description,
      examples: scanExamples(path.join(skillDir, 'examples', name), `${skillName}/examples/${name}`, name, errors),
    };
  });
}

/**
 * Scan the rules/ directory of a component-layout skill.
 */
function scanRules(skillDir, skillName, errors) {
  return listMarkdownFiles(path.join(skillDir, 'rules')).map((file) => {
    const filePath = `${skillName}/rules/${file}`;
    const fm = parseFrontmatter(fs.readFileSync(path.join(skillDir, 'rules', file), 'utf-8'), filePath, errors) ?? {};
    const filenameWithoutExt = file.replace(/\.md$/, '');
    const name = typeof fm.name === 'string' && fm.name ? fm.name : filenameWithoutExt;
    const constraint = typeof fm.constraint === 'string' ? fm.constraint.trim() : '';

    if (name !== filenameWithoutExt) {
      errors.push(`${filePath}: frontmatter "name" must match filename "${filenameWithoutExt}"`);
    }
    if (!constraint) {
      errors.push(`${filePath}: missing non-empty "constraint"`);
    }
    if (fm.severity !== undefined && !VALID_RULE_SEVERITIES.includes(fm.severity)) {
      errors.push(`${filePath}: invalid "severity" value "${fm.severity}"`);
    }

    return fm.severity === undefined ? { name, constraint } : { name, constraint, severity: fm.severity };
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
  const fm = parseFrontmatter(content, `${dir}/SKILL.md`, errors);

  if (!fm || typeof fm.name !== 'string' || !fm.name) {
    errors.push(`${dir}/SKILL.md: missing valid frontmatter or 'name' must be a non-empty string`);
    continue;
  }

  if (fm.description != null && typeof fm.description !== 'string') {
    errors.push(`${dir}/SKILL.md: description must be a string`);
    continue;
  }

  const layout = fm.layout ?? 'router';
  const category = fm.category || dir.replace('frontmcp-', '');
  const targets = toStringArray(fm.targets, ['all'], 'targets', errors, dir);
  const tags = toStringArray(fm.tags, [], 'tags', errors, dir);
  const bundle = toStringArray(fm.bundle, ['full'], 'bundle', errors, dir);

  if (!targets || !tags || !bundle) continue;

  // Validate against allow-lists
  if (!VALID_LAYOUTS.includes(layout)) {
    errors.push(`${dir}/SKILL.md: invalid layout '${layout}' (valid: ${VALID_LAYOUTS.join(', ')})`);
    continue;
  }

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
  const isComponent = layout === 'component';
  const description = fm.description || '';
  const refs = scanReferences(skillDirPath, dir, layout, errors);

  const entry = {
    name: fm.name,
    category,
    description: isComponent ? firstParagraph(description) : description,
    path: dir,
    targets,
    hasResources: hasResources(skillDirPath),
    ...(isComponent && { layout }),
    tags,
    bundle,
    ...(typeof fm.priority === 'number' && { priority: fm.priority }),
  };

  if (refs && refs.length > 0) {
    entry.references = refs;
  }

  if (isComponent) {
    entry.examples = scanExamples(path.join(skillDirPath, 'examples'), `${dir}/examples`, undefined, errors);
    entry.rules = scanRules(skillDirPath, dir, errors);
  }

  skills.push(entry);
}

if (errors.length > 0) {
  for (const err of errors) console.error(`ERROR: ${err}`);
  process.exit(1);
}

const manifest = { version: 1, skills };
// Formatted as the pre-commit hook formats it, so a committed manifest passes --check.
const prettierConfig = await prettier.resolveConfig(MANIFEST_PATH);
const output = await prettier.format(JSON.stringify(manifest), { ...prettierConfig, filepath: MANIFEST_PATH });

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
