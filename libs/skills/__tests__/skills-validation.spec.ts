/**
 * Skills catalog validation tests.
 *
 * Validates that all SKILL.md files in the catalog:
 * - Parse correctly via the SDK's frontmatter parser
 * - Have required fields (name, description, body)
 * - Are listed in the manifest (no orphans)
 * - Match their manifest entries
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSkillMdFrontmatter, skillMdFrontmatterToMetadata } from '../../sdk/src/skill/skill-md-parser';
import type { SkillManifest, SkillCatalogEntry } from '../src/manifest';
import { VALID_TARGETS, VALID_CATEGORIES, VALID_BUNDLES, VALID_EXAMPLE_LEVELS } from '../src/manifest';

const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');
const MANIFEST_PATH = path.join(CATALOG_DIR, 'skills-manifest.json');

function loadManifestSync(): SkillManifest {
  const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(content) as SkillManifest;
}

function findAllSkillDirs(): string[] {
  const dirs: string[] = [];
  const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });

  for (const entry of entries) {
    const entryDir = path.join(CATALOG_DIR, entry);
    // Skills can be directly in the catalog root (flat structure)
    if (fs.existsSync(path.join(entryDir, 'SKILL.md'))) {
      dirs.push(entry);
      continue;
    }
    // Or nested inside a category directory (legacy structure)
    const skills = fs.readdirSync(entryDir).filter((f) => {
      const full = path.join(entryDir, f);
      return fs.statSync(full).isDirectory();
    });
    for (const skill of skills) {
      const skillDir = path.join(entryDir, skill);
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        dirs.push(`${entry}/${skill}`);
      }
    }
  }
  return dirs;
}

function readMarkdownBody(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function extractFirstParagraph(content: string): string {
  const body = readMarkdownBody(content);
  const lines = body.split(/\r?\n/);
  let sawHeading = false;
  const paragraph: string[] = [];

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

function extractSectionBullets(content: string, heading: string): string[] {
  const body = readMarkdownBody(content);
  const lines = body.split(/\r?\n/);
  const bullets: string[] = [];
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

function humanizeExampleLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function parseExamplesTableRows(content: string): Array<{ name: string; level: string; description: string }> {
  const lines = content.split(/\r?\n/);
  const rows: Array<{ name: string; level: string; description: string }> = [];
  let inTable = false;

  for (const line of lines) {
    const normalizedCells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (
      normalizedCells.length === 3 &&
      normalizedCells[0] === 'Example' &&
      normalizedCells[1] === 'Level' &&
      normalizedCells[2] === 'Description'
    ) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith('| ---')) continue;
    if (!line.startsWith('|')) break;

    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;

    const exampleCell = cells[1];
    const level = cells[2];
    const description = cells[3];
    const nameMatch = exampleCell.match(/\[`([^`]+)`\]/);

    rows.push({
      name: nameMatch ? nameMatch[1] : exampleCell,
      level,
      description,
    });
  }

  return rows;
}

function getAllReferenceFiles(): { skill: string; file: string; fullPath: string }[] {
  const results: { skill: string; file: string; fullPath: string }[] = [];
  const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });
  for (const entry of entries) {
    const refsDir = path.join(CATALOG_DIR, entry, 'references');
    if (fs.existsSync(refsDir)) {
      const files = fs.readdirSync(refsDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        results.push({ skill: entry, file, fullPath: path.join(refsDir, file) });
      }
    }
    const skillMd = path.join(CATALOG_DIR, entry, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      results.push({ skill: entry, file: 'SKILL.md', fullPath: skillMd });
    }
  }
  return results;
}

function getAllExampleFiles(): { skill: string; reference: string; file: string; fullPath: string }[] {
  const results: { skill: string; reference: string; file: string; fullPath: string }[] = [];
  const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });
  for (const entry of entries) {
    const examplesDir = path.join(CATALOG_DIR, entry, 'examples');
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

describe('skills catalog validation', () => {
  let manifest: SkillManifest;
  let skillDirs: string[];

  beforeAll(() => {
    manifest = loadManifestSync();
    skillDirs = findAllSkillDirs();
  });

  describe('manifest structure', () => {
    it('should have version 1', () => {
      expect(manifest.version).toBe(1);
    });

    it('should have at least one skill', () => {
      expect(manifest.skills.length).toBeGreaterThan(0);
    });

    it('should have unique skill names', () => {
      const names = manifest.skills.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should have unique paths', () => {
      const paths = manifest.skills.map((s) => s.path);
      expect(new Set(paths).size).toBe(paths.length);
    });
  });

  describe('manifest entries', () => {
    it.each(
      // Load manifest lazily to avoid issues with beforeAll timing in .each
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" should have valid targets', (_, entry) => {
      for (const target of entry.targets) {
        expect(VALID_TARGETS).toContain(target);
      }
      expect(entry.targets.length).toBeGreaterThan(0);
    });

    it.each(
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" should have a valid category', (_, entry) => {
      expect(VALID_CATEGORIES).toContain(entry.category);
    });

    it.each(
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" should have valid bundles if specified', (_, entry) => {
      if (entry.bundle) {
        for (const b of entry.bundle) {
          expect(VALID_BUNDLES).toContain(b);
        }
      }
    });

    it.each(
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" should have a corresponding SKILL.md on disk', (_, entry) => {
      const skillMdPath = path.join(CATALOG_DIR, entry.path, 'SKILL.md');
      expect(fs.existsSync(skillMdPath)).toBe(true);
    });

    it.each(
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" hasResources should match actual directory contents', (_, entry) => {
      const skillPath = path.join(CATALOG_DIR, entry.path);
      const hasScripts = fs.existsSync(path.join(skillPath, 'scripts'));
      const hasReferences = fs.existsSync(path.join(skillPath, 'references'));
      const hasAssets = fs.existsSync(path.join(skillPath, 'assets'));
      const actualHasResources = hasScripts || hasReferences || hasAssets;
      expect(entry.hasResources).toBe(actualHasResources);
    });

    it.each(
      (() => {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as SkillManifest;
        return m.skills.map((s) => [s.name, s] as [string, SkillCatalogEntry]);
      })(),
    )('"%s" should have valid install config if present', (_, entry) => {
      if (entry.install) {
        expect(entry.install.destinations.length).toBeGreaterThan(0);
        expect(['overwrite', 'skip-existing']).toContain(entry.install.mergeStrategy);
      }
    });
  });

  describe('SKILL.md files', () => {
    it.each(
      (() => {
        const dirs = findAllSkillDirs();
        return dirs.map((d) => [d]);
      })(),
    )('"%s" should parse with valid frontmatter', (dir) => {
      const content = fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
      const { frontmatter, body } = parseSkillMdFrontmatter(content);

      expect(frontmatter['name']).toBeDefined();
      expect(typeof frontmatter['name']).toBe('string');
      expect(frontmatter['description']).toBeDefined();
      expect(typeof frontmatter['description']).toBe('string');
      expect(body.length).toBeGreaterThan(0);
    });

    it.each(
      (() => {
        const dirs = findAllSkillDirs();
        return dirs.map((d) => [d]);
      })(),
    )('"%s" should produce valid metadata', (dir) => {
      const content = fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
      const { frontmatter, body } = parseSkillMdFrontmatter(content);
      const metadata = skillMdFrontmatterToMetadata(frontmatter, body);

      expect(metadata.name).toBeDefined();
      expect(metadata.description).toBeDefined();
      expect(metadata.instructions).toBeDefined();
      expect((metadata.instructions as string).length).toBeGreaterThan(50);
    });
  });

  describe('dependency resolution', () => {
    it('all install.dependencies should reference existing skill names', () => {
      const allNames = new Set(manifest.skills.map((s) => s.name));
      const broken: string[] = [];
      for (const entry of manifest.skills) {
        if (entry.install?.dependencies) {
          for (const dep of entry.install.dependencies) {
            if (!allNames.has(dep)) {
              broken.push(`${entry.name} depends on "${dep}" which does not exist in manifest`);
            }
          }
        }
      }
      expect(broken).toEqual([]);
    });
  });

  describe('parsed metadata quality', () => {
    it.each(
      (() => {
        const dirs = findAllSkillDirs();
        return dirs.map((d) => [d]);
      })(),
    )('"%s" should preserve examples after parsing if frontmatter has scenario-based examples', (dir) => {
      const content = fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
      const { frontmatter, body } = parseSkillMdFrontmatter(content);
      const metadata = skillMdFrontmatterToMetadata(frontmatter, body);

      // If frontmatter has examples with 'scenario' key, parsed metadata should preserve them
      const rawExamples = frontmatter['examples'] as Array<Record<string, unknown>> | undefined;
      if (rawExamples && rawExamples.some((e) => 'scenario' in e)) {
        expect(metadata.examples?.length).toBeGreaterThan(0);
      }
    });

    it.each(
      (() => {
        const dirs = findAllSkillDirs();
        return dirs.map((d) => [d]);
      })(),
    )('"%s" should preserve compatibility after parsing if frontmatter has string compatibility', (dir) => {
      const content = fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
      const { frontmatter, body } = parseSkillMdFrontmatter(content);
      const metadata = skillMdFrontmatterToMetadata(frontmatter, body);

      if (typeof frontmatter['compatibility'] === 'string') {
        expect(metadata.compatibility).toBeDefined();
      }
    });
  });

  describe('manifest <-> filesystem sync', () => {
    it('every SKILL.md directory should be listed in the manifest', () => {
      const manifestPaths = new Set(manifest.skills.map((s) => s.path));
      const orphans = skillDirs.filter((d) => !manifestPaths.has(d));
      expect(orphans).toEqual([]);
    });

    it('every manifest entry should have a SKILL.md on disk', () => {
      const missing = manifest.skills.filter((s) => !fs.existsSync(path.join(CATALOG_DIR, s.path, 'SKILL.md')));
      expect(missing.map((s) => s.name)).toEqual([]);
    });

    it('manifest names should match SKILL.md frontmatter names', () => {
      const mismatches: string[] = [];
      for (const entry of manifest.skills) {
        const content = fs.readFileSync(path.join(CATALOG_DIR, entry.path, 'SKILL.md'), 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        if (frontmatter['name'] !== entry.name) {
          mismatches.push(`${entry.name}: manifest="${entry.name}" vs SKILL.md="${frontmatter['name']}"`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('manifest descriptions should match SKILL.md frontmatter descriptions', () => {
      const mismatches: string[] = [];
      for (const entry of manifest.skills) {
        const content = fs.readFileSync(path.join(CATALOG_DIR, entry.path, 'SKILL.md'), 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        const mdDesc = frontmatter['description'] as string | undefined;
        if (mdDesc && mdDesc !== entry.description) {
          mismatches.push(`${entry.name}: manifest description differs from SKILL.md frontmatter`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('semantic content validation', () => {
    const documentationFiles = [
      ...getAllReferenceFiles(),
      ...getAllExampleFiles().map(({ skill, file, fullPath, reference }) => ({
        skill,
        file: `examples/${reference}/${file}`,
        fullPath,
      })),
    ];

    it('should not use invalid LLM "adapter" field in code examples', () => {
      const violations: string[] = [];
      for (const { skill, file, fullPath } of documentationFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Match adapter: 'anthropic' or adapter: 'openai' in code blocks
        const adapterMatches = content.match(/adapter:\s*['"](?:anthropic|openai)['"]/g);
        if (adapterMatches) {
          violations.push(`${skill}/${file}: found ${adapterMatches.length}x "adapter:" — should be "provider:"`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('should not use auth string shorthand in decorator context', () => {
      const violations: string[] = [];
      for (const { skill, file, fullPath } of documentationFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Match auth: 'remote', auth: 'public', auth: 'transparent' as standalone config values
        const authShorthand = content.match(/auth:\s*['"](?:remote|public|transparent)['"]/g);
        if (authShorthand) {
          violations.push(`${skill}/${file}: found auth string shorthand — should be auth: { mode: '...' }`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('should not use "streamable-http" as a transport preset in SDK context', () => {
      const violations: string[] = [];
      const validPresets = ['modern', 'legacy', 'stateless-api', 'full'];
      for (const { skill, file, fullPath } of documentationFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Match protocol: 'streamable-http' or transport: 'streamable-http'
        const matches = content.match(/(?:protocol|transport):\s*['"]streamable-http['"]/g);
        if (matches) {
          violations.push(
            `${skill}/${file}: found "streamable-http" preset — valid presets are: ${validPresets.join(', ')}`,
          );
        }
      }
      expect(violations).toEqual([]);
    });

    it('should not use bare @App() without metadata', () => {
      const violations: string[] = [];
      for (const { skill, file, fullPath } of documentationFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Match @App() with empty parens (no arguments)
        const bareApp = content.match(/@App\(\s*\)/g);
        if (bareApp) {
          violations.push(`${skill}/${file}: found bare @App() — must include { name: '...' }`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('should not use "session:" as a top-level @FrontMcp field', () => {
      const violations: string[] = [];
      for (const { skill, file, fullPath } of documentationFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Look for session: { ... } in decorator blocks (preceded by @FrontMcp)
        // Simple heuristic: find session: { store in code blocks
        const sessionStore = content.match(/session:\s*\{\s*\n?\s*store:/g);
        if (sessionStore) {
          violations.push(`${skill}/${file}: found top-level "session:" field — use "redis:" at top level instead`);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('examples validation', () => {
    it('every examples/ subfolder should match a reference filename', () => {
      const mismatches: string[] = [];
      const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
        const full = path.join(CATALOG_DIR, f);
        return fs.statSync(full).isDirectory() && f !== 'node_modules';
      });
      for (const entry of entries) {
        const examplesDir = path.join(CATALOG_DIR, entry, 'examples');
        if (!fs.existsSync(examplesDir)) continue;
        const refsDir = path.join(CATALOG_DIR, entry, 'references');
        const refNames = fs.existsSync(refsDir)
          ? fs
              .readdirSync(refsDir)
              .filter((f) => f.endsWith('.md'))
              .map((f) => f.replace(/\.md$/, ''))
          : [];
        const exampleDirs = fs.readdirSync(examplesDir).filter((f) => {
          return fs.statSync(path.join(examplesDir, f)).isDirectory();
        });
        for (const dir of exampleDirs) {
          if (!refNames.includes(dir)) {
            mismatches.push(`${entry}/examples/${dir} has no matching reference file`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('every example .md file should have valid frontmatter', () => {
      const invalid: string[] = [];
      for (const { skill, reference, file, fullPath } of getAllExampleFiles()) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        const expectedName = file.replace(/\.md$/, '');
        if (!frontmatter['name'] || typeof frontmatter['name'] !== 'string') {
          invalid.push(`${skill}/examples/${reference}/${file}: missing or invalid "name" in frontmatter`);
        }
        if (frontmatter['name'] && frontmatter['name'] !== expectedName) {
          invalid.push(
            `${skill}/examples/${reference}/${file}: frontmatter "name" must match filename "${expectedName}"`,
          );
        }
        if (!frontmatter['reference'] || typeof frontmatter['reference'] !== 'string') {
          invalid.push(`${skill}/examples/${reference}/${file}: missing or invalid "reference" in frontmatter`);
        }
        if (
          !frontmatter['level'] ||
          !(VALID_EXAMPLE_LEVELS as readonly string[]).includes(frontmatter['level'] as string)
        ) {
          invalid.push(
            `${skill}/examples/${reference}/${file}: missing or invalid "level" in frontmatter (must be ${VALID_EXAMPLE_LEVELS.join(', ')})`,
          );
        }
        if (!frontmatter['description'] || typeof frontmatter['description'] !== 'string') {
          invalid.push(`${skill}/examples/${reference}/${file}: missing or invalid "description" in frontmatter`);
        }
        const tags = frontmatter['tags'];
        if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
          invalid.push(`${skill}/examples/${reference}/${file}: missing or invalid "tags" in frontmatter`);
        }
        const features = frontmatter['features'];
        if (
          !Array.isArray(features) ||
          features.length === 0 ||
          features.some((feature) => typeof feature !== 'string' || !feature.trim())
        ) {
          invalid.push(`${skill}/examples/${reference}/${file}: missing or invalid "features" in frontmatter`);
        }
        // reference field should match the parent directory name
        if (frontmatter['reference'] && frontmatter['reference'] !== reference) {
          invalid.push(
            `${skill}/examples/${reference}/${file}: frontmatter "reference" is "${frontmatter['reference']}" but expected "${reference}"`,
          );
        }
      }
      expect(invalid).toEqual([]);
    });

    it('example frontmatter should stay aligned with the example body', () => {
      const mismatches: string[] = [];
      for (const { skill, reference, file, fullPath } of getAllExampleFiles()) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '';
        const features = Array.isArray(frontmatter['features'])
          ? frontmatter['features'].filter((feature): feature is string => typeof feature === 'string')
          : [];
        const firstParagraph = extractFirstParagraph(content);
        const whatThisDemonstrates = extractSectionBullets(content, 'What This Demonstrates');

        if (description !== firstParagraph) {
          mismatches.push(
            `${skill}/examples/${reference}/${file}: frontmatter "description" must match the first paragraph after the H1`,
          );
        }
        if (JSON.stringify(features) !== JSON.stringify(whatThisDemonstrates)) {
          mismatches.push(
            `${skill}/examples/${reference}/${file}: frontmatter "features" must match the "What This Demonstrates" bullets`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('manifest example entries should match example file metadata', () => {
      const mismatches: string[] = [];
      const manifestExampleKeys = new Set<string>();
      for (const entry of manifest.skills) {
        if (!entry.references) continue;
        for (const ref of entry.references) {
          const examples = ref.examples ?? [];
          const exampleDir = path.join(CATALOG_DIR, entry.path, 'examples', ref.name);
          for (const example of examples) {
            manifestExampleKeys.add(`${entry.path}/${ref.name}/${example.name}`);
            const exampleFile = path.join(exampleDir, `${example.name}.md`);
            if (!fs.existsSync(exampleFile)) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}.md listed in manifest but missing on disk`);
              continue;
            }
            if (!(VALID_EXAMPLE_LEVELS as readonly string[]).includes(example.level)) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name} has invalid level "${example.level}"`);
            }
            if (!Array.isArray(example.tags) || example.tags.length === 0) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name} has invalid manifest tags`);
            }
            if (!Array.isArray(example.features) || example.features.length === 0) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name} has invalid manifest features`);
            }

            const { frontmatter } = parseSkillMdFrontmatter(fs.readFileSync(exampleFile, 'utf-8'));
            const fileDescription = typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '';
            const fileLevel = typeof frontmatter['level'] === 'string' ? frontmatter['level'] : '';
            const fileTags = Array.isArray(frontmatter['tags'])
              ? frontmatter['tags'].filter((tag): tag is string => typeof tag === 'string')
              : [];
            const fileFeatures = Array.isArray(frontmatter['features'])
              ? frontmatter['features'].filter((feature): feature is string => typeof feature === 'string')
              : [];

            if (example.description !== fileDescription) {
              mismatches.push(
                `${entry.name}/${ref.name}/${example.name}: manifest description differs from example file`,
              );
            }
            if (example.level !== fileLevel) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}: manifest level differs from example file`);
            }
            if (JSON.stringify(example.tags) !== JSON.stringify(fileTags)) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}: manifest tags differ from example file`);
            }
            if (JSON.stringify(example.features) !== JSON.stringify(fileFeatures)) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}: manifest features differ from example file`);
            }
          }
        }
      }

      for (const { skill, reference, file } of getAllExampleFiles()) {
        const exampleName = file.replace(/\.md$/, '');
        const key = `${skill}/${reference}/${exampleName}`;
        if (!manifestExampleKeys.has(key)) {
          mismatches.push(`${key}.md exists on disk but is missing from the manifest`);
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('reference example tables should match manifest example metadata', () => {
      const mismatches: string[] = [];
      for (const entry of manifest.skills) {
        for (const ref of entry.references ?? []) {
          const referencePath = path.join(CATALOG_DIR, entry.path, 'references', `${ref.name}.md`);
          if (!fs.existsSync(referencePath)) continue;

          const tableRows = parseExamplesTableRows(fs.readFileSync(referencePath, 'utf-8'));
          const examples = ref.examples ?? [];

          if (tableRows.length !== examples.length) {
            mismatches.push(
              `${entry.name}/${ref.name}: reference table has ${tableRows.length} rows but manifest has ${examples.length} examples`,
            );
            continue;
          }

          for (const example of examples) {
            const row = tableRows.find((tableRow) => tableRow.name === example.name);
            if (!row) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}: missing from reference example table`);
              continue;
            }

            if (row.description !== example.description) {
              mismatches.push(
                `${entry.name}/${ref.name}/${example.name}: reference table description differs from manifest`,
              );
            }
            if (row.level !== humanizeExampleLevel(example.level)) {
              mismatches.push(`${entry.name}/${ref.name}/${example.name}: reference table level differs from manifest`);
            }
          }
        }
      }

      expect(mismatches).toEqual([]);
    });
  });

  describe('new-format migration tracking', () => {
    function getSkillBody(dir: string): string {
      return fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
    }

    it('should track migration progress across the catalog', () => {
      let migrated = 0;
      const total = skillDirs.length;
      for (const dir of skillDirs) {
        const content = getSkillBody(dir);
        const hasNewWhenToUse = content.includes('## When to Use This Skill') && content.includes('### Must Use');
        if (hasNewWhenToUse) {
          migrated++;
        }
      }
      // Log migration progress for visibility

      console.log(`[migration] ${migrated}/${total} skills migrated to new format`);
      // This will pass regardless -- it's a progress tracker, not a gate
      expect(migrated).toBeGreaterThanOrEqual(0);
    });

    it.each(
      (() => {
        const dirs = findAllSkillDirs();
        return dirs.map((d) => [d]);
      })(),
    )('"%s" migrated skills should have all required new-format sections', (dir) => {
      const content = getSkillBody(dir);
      const isMigrated = content.includes('## When to Use This Skill') && content.includes('### Must Use');
      if (!isMigrated) {
        // Skip validation for unmigrated skills
        return;
      }

      // Migrated skills must have the full new structure
      expect(content).toContain('### Must Use');
      expect(content).toContain('### Recommended');
      expect(content).toContain('### Skip When');
      expect(content).toContain('## Verification Checklist');
    });
  });
});
