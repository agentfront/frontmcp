#!/usr/bin/env node
/**
 * Sync catalog metadata across the three layers:
 *   1. example file body (H1 paragraph + "## What This Demonstrates" bullets)
 *   2. example file frontmatter (description + features)
 *   3. manifest entry (description + tags + features)
 *   4. reference file's "## Examples" table (description column)
 *
 * Source-of-truth for each pair:
 *   body         → frontmatter (1 → 2)
 *   frontmatter  → manifest (2 → 3)
 *   manifest     → reference table (3 → 4)
 *
 * Tags are kept from the existing frontmatter (body has no canonical tag list).
 * If frontmatter tags drift from manifest, frontmatter wins (per the validation
 * spec which treats the file as source of truth for description/level/tags/features).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

const REPO = '/Users/davidfrontegg/git/frontmcp-oss';
const CATALOG = path.join(REPO, 'libs/skills/catalog');
const MANIFEST = path.join(CATALOG, 'skills-manifest.json');

function readBody(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, raw: '' };
  const fm = yaml.load(m[1]) ?? {};
  return { frontmatter: fm, raw: m[0] };
}

function writeFrontmatter(content, fm) {
  const yamlStr = yaml.dump(fm, { lineWidth: 1000, quotingType: "'", forceQuotes: false });
  const body = readBody(content);
  return `---\n${yamlStr}---\n\n${body.replace(/^\n+/, '')}`;
}

function extractFirstParagraph(content) {
  const body = readBody(content);
  const lines = body.split(/\r?\n/);
  let sawHeading = false;
  const paragraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawHeading && trimmed.startsWith('#')) {
      sawHeading = true;
      continue;
    }
    if (!sawHeading) continue;
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (trimmed.startsWith('##')) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.join(' ');
}

function extractSectionBullets(content, heading) {
  const body = readBody(content);
  const lines = body.split(/\r?\n/);
  const bullets = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === `## ${heading}`) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (trimmed.startsWith('## ')) break;
    if (trimmed.startsWith('- ')) {
      bullets.push(trimmed.slice(2).trim());
    }
  }
  return bullets;
}

function humanizeLevel(level) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function getAllExampleFiles() {
  const results = [];
  const entries = fs.readdirSync(CATALOG).filter((f) => {
    const full = path.join(CATALOG, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });
  for (const entry of entries) {
    const examplesDir = path.join(CATALOG, entry, 'examples');
    if (!fs.existsSync(examplesDir)) continue;
    const refDirs = fs.readdirSync(examplesDir).filter((f) => {
      return fs.statSync(path.join(examplesDir, f)).isDirectory();
    });
    for (const refDir of refDirs) {
      const refPath = path.join(examplesDir, refDir);
      const files = fs.readdirSync(refPath).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        results.push({
          skill: entry,
          reference: refDir,
          file,
          fullPath: path.join(refPath, file),
        });
      }
    }
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────
// PASS 1: sync example frontmatter (description + features) to body
// ──────────────────────────────────────────────────────────────────

console.log('PASS 1: syncing example frontmatter to body...');
let pass1Changes = 0;
const exampleFiles = getAllExampleFiles();
for (const { skill, reference, file, fullPath } of exampleFiles) {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const { frontmatter } = parseFrontmatter(content);
  const firstPara = extractFirstParagraph(content);
  const bullets = extractSectionBullets(content, 'What This Demonstrates');

  const oldDesc = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const oldFeatures = Array.isArray(frontmatter.features) ? frontmatter.features : [];

  let changed = false;
  if (firstPara && oldDesc !== firstPara) {
    frontmatter.description = firstPara;
    changed = true;
  }
  if (bullets.length > 0 && JSON.stringify(oldFeatures) !== JSON.stringify(bullets)) {
    frontmatter.features = bullets;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(fullPath, writeFrontmatter(content, frontmatter), 'utf-8');
    pass1Changes++;
    console.log(`  synced ${skill}/examples/${reference}/${file}`);
  }
}
console.log(`PASS 1 done. ${pass1Changes} files updated.`);

// ──────────────────────────────────────────────────────────────────
// PASS 2: sync manifest example entries to file frontmatter
// ──────────────────────────────────────────────────────────────────

console.log('\nPASS 2: syncing manifest to example frontmatter...');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
let pass2Changes = 0;

for (const skillEntry of manifest.skills) {
  if (!skillEntry.references) continue;
  for (const ref of skillEntry.references) {
    if (!ref.examples) continue;
    for (const example of ref.examples) {
      const exampleFile = path.join(CATALOG, skillEntry.path, 'examples', ref.name, `${example.name}.md`);
      if (!fs.existsSync(exampleFile)) continue;

      const { frontmatter } = parseFrontmatter(fs.readFileSync(exampleFile, 'utf-8'));
      const fileDesc = typeof frontmatter.description === 'string' ? frontmatter.description : '';
      const fileLevel = typeof frontmatter.level === 'string' ? frontmatter.level : '';
      const fileTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags.filter((t) => typeof t === 'string')
        : [];
      const fileFeatures = Array.isArray(frontmatter.features)
        ? frontmatter.features.filter((f) => typeof f === 'string')
        : [];

      let changed = false;
      if (example.description !== fileDesc) {
        example.description = fileDesc;
        changed = true;
      }
      if (example.level !== fileLevel) {
        example.level = fileLevel;
        changed = true;
      }
      if (JSON.stringify(example.tags) !== JSON.stringify(fileTags)) {
        example.tags = fileTags;
        changed = true;
      }
      if (JSON.stringify(example.features) !== JSON.stringify(fileFeatures)) {
        example.features = fileFeatures;
        changed = true;
      }
      if (changed) {
        pass2Changes++;
        console.log(`  synced manifest: ${skillEntry.path}/${ref.name}/${example.name}`);
      }
    }
  }
}

if (pass2Changes > 0) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}
console.log(`PASS 2 done. ${pass2Changes} manifest entries updated.`);

// ──────────────────────────────────────────────────────────────────
// PASS 3: sync reference example tables to manifest
// ──────────────────────────────────────────────────────────────────

console.log('\nPASS 3: syncing reference example tables to manifest...');
let pass3Changes = 0;

function rewriteExampleTableRow(line, example) {
  // line shape: | [`name`](href) | Level | description |
  // Update the description cell only (last cell).
  const cells = line.split('|');
  if (cells.length < 5) return line;
  // cells[0] empty, cells[1] = exampleCell, cells[2] = level, cells[3] = description, cells[4] empty (trailing)
  const exampleCell = cells[1];
  const nameMatch = exampleCell.match(/\[`([^`]+)`\]/);
  if (!nameMatch || nameMatch[1] !== example.name) return line;
  cells[3] = ` ${example.description} `;
  cells[2] = ` ${humanizeLevel(example.level)} `;
  return cells.join('|');
}

for (const skillEntry of manifest.skills) {
  if (!skillEntry.references) continue;
  for (const ref of skillEntry.references) {
    if (!ref.examples || ref.examples.length === 0) continue;
    const refPath = path.join(CATALOG, skillEntry.path, 'references', `${ref.name}.md`);
    if (!fs.existsSync(refPath)) continue;
    let content = fs.readFileSync(refPath, 'utf-8');
    const original = content;

    const lines = content.split(/\r?\n/);
    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length === 3 && cells[0] === 'Example' && cells[1] === 'Level' && cells[2] === 'Description') {
        inTable = true;
        continue;
      }
      if (!inTable) continue;
      if (line.trim().startsWith('| ---')) continue;
      if (!line.startsWith('|')) {
        inTable = false;
        continue;
      }
      // Match the example name in the row
      const exampleCell = line.split('|')[1] ?? '';
      const nameMatch = exampleCell.match(/\[`([^`]+)`\]/);
      if (!nameMatch) continue;
      const example = ref.examples.find((e) => e.name === nameMatch[1]);
      if (!example) continue;
      lines[i] = rewriteExampleTableRow(line, example);
    }
    content = lines.join('\n');
    if (content !== original) {
      fs.writeFileSync(refPath, content, 'utf-8');
      pass3Changes++;
      console.log(`  synced ref-table: ${skillEntry.path}/references/${ref.name}.md`);
    }
  }
}
console.log(`PASS 3 done. ${pass3Changes} reference tables updated.`);
console.log(`\nTotal changes: ${pass1Changes} files, ${pass2Changes} manifest entries, ${pass3Changes} ref tables.`);
