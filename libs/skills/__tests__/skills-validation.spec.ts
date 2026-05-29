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
import {
  VALID_BUNDLES,
  VALID_CATEGORIES,
  VALID_EXAMPLE_LEVELS,
  VALID_TARGETS,
  type SkillCatalogEntry,
  type SkillManifest,
} from '../src/manifest';

const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');
const MANIFEST_PATH = path.join(CATALOG_DIR, 'skills-manifest.json');

function loadManifestSync(): SkillManifest {
  const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(content) as SkillManifest;
}

/**
 * Resolve the catalog layout for a skill directory by consulting the
 * manifest. `layout: 'component'` skills use a different SKILL.md
 * structure (rich frontmatter for Claude auto-trigger, flat examples,
 * no TEMPLATE.md-derived section headings) and need a different set
 * of structural checks than the legacy `'router'` layout.
 *
 * Lazy-cached so we don't re-parse the manifest per assertion. The cache
 * is reset in a top-level `beforeEach` (see the describe block below) so
 * watch-mode reruns pick up edits to `skills-manifest.json` instead of
 * holding a stale layout map across runs.
 */
let _layoutCache: Map<string, 'router' | 'component'> | undefined;
function getSkillLayout(dir: string): 'router' | 'component' {
  if (!_layoutCache) {
    _layoutCache = new Map();
    const manifest = loadManifestSync();
    for (const entry of manifest.skills) {
      _layoutCache.set(entry.path, entry.layout ?? 'router');
    }
  }
  return _layoutCache.get(dir) ?? 'router';
}
function resetSkillLayoutCache(): void {
  _layoutCache = undefined;
}
function isComponentLayout(dir: string): boolean {
  return getSkillLayout(dir) === 'component';
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

function parseExamplesTableRows(
  content: string,
): Array<{ name: string; level: string; description: string; href?: string }> {
  const lines = content.split(/\r?\n/);
  const rows: Array<{ name: string; level: string; description: string; href?: string }> = [];
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
    const hrefMatch = exampleCell.match(/\]\(([^)]+)\)/);

    rows.push({
      name: nameMatch ? nameMatch[1] : exampleCell,
      level,
      description,
      href: hrefMatch ? hrefMatch[1] : undefined,
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

/**
 * Walk every skill in the catalog and surface its example files.
 *
 * Handles both layouts:
 *
 * - Router (legacy `frontmcp-*` skills): `examples/<reference>/<example>.md`
 *   — examples are grouped under a parent reference. `reference` is set to
 *   the subdirectory name.
 *
 * - Component (new per-thing skills like `create-tool`): `examples/<example>.md`
 *   — examples live flat under `examples/` with no parent reference. `reference`
 *   is set to the sentinel `'_top'` so callers can detect the layout without
 *   stat'ing the path again.
 */
function getAllExampleFiles(): { skill: string; reference: string; file: string; fullPath: string }[] {
  const results: { skill: string; reference: string; file: string; fullPath: string }[] = [];
  const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });
  for (const entry of entries) {
    const examplesDir = path.join(CATALOG_DIR, entry, 'examples');
    if (!fs.existsSync(examplesDir)) continue;
    const items = fs.readdirSync(examplesDir);
    for (const item of items) {
      const itemPath = path.join(examplesDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        // Router layout: examples grouped under references.
        const files = fs.readdirSync(itemPath).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          results.push({
            skill: entry,
            reference: item,
            file,
            fullPath: path.join(itemPath, file),
          });
        }
      } else if (stat.isFile() && item.endsWith('.md')) {
        // Component layout: flat examples directly under examples/.
        results.push({
          skill: entry,
          reference: '_top',
          file: item,
          fullPath: itemPath,
        });
      }
    }
  }
  return results;
}

/**
 * Return every rule file for component-layout skills:
 * `rules/<rule>.md`. Router-layout skills don't have a `rules/` directory.
 */
function getAllRuleFiles(): { skill: string; file: string; fullPath: string }[] {
  const results: { skill: string; file: string; fullPath: string }[] = [];
  const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });
  for (const entry of entries) {
    const rulesDir = path.join(CATALOG_DIR, entry, 'rules');
    if (!fs.existsSync(rulesDir)) continue;
    const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      results.push({
        skill: entry,
        file,
        fullPath: path.join(rulesDir, file),
      });
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

  beforeEach(() => {
    // Watch-mode safety: the manifest can be edited between runs (especially
    // when iterating on a component-layout skill); reset the cached layout
    // map so each describe block sees the freshly-loaded layout assignments.
    resetSkillLayoutCache();
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
        // Component-layout skills intentionally use a rich, multi-line
        // SKILL.md `description:` block (triggers + when-to-use prose, tuned
        // for Claude Code's auto-discovery) and a shorter listing-friendly
        // description in the manifest. They are not expected to match.
        if (entry.layout === 'component') continue;
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
        // Router-layout examples live under examples/<ref>/<file>; component-layout
        // examples are flat under examples/<file> (reference === '_top').
        file: reference === '_top' ? `examples/${file}` : `examples/${reference}/${file}`,
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
      // The /metrics endpoint (issue #397) has its OWN `auth` option whose
      // legal values include 'public' and 'token'. The decorator-level auth
      // shorthand deprecation does NOT apply to it, so the metrics skill
      // surface is exempted from this guard.
      const METRICS_AUTH_FILES = new Set([
        'frontmcp-observability/metrics-endpoint.md',
        'frontmcp-observability/examples/metrics-endpoint/enable-metrics-endpoint.md',
      ]);
      for (const { skill, file, fullPath } of documentationFiles) {
        if (METRICS_AUTH_FILES.has(`${skill}/${file}`)) continue;
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
    it('every examples/ subfolder should match a reference filename (router layout only)', () => {
      const mismatches: string[] = [];
      const entries = fs.readdirSync(CATALOG_DIR).filter((f) => {
        const full = path.join(CATALOG_DIR, f);
        return fs.statSync(full).isDirectory() && f !== 'node_modules';
      });
      for (const entry of entries) {
        // Component-layout skills use a flat examples/ directory — there are
        // no subfolders to match against references. Skip them entirely.
        if (isComponentLayout(entry)) continue;
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
        const isComponent = reference === '_top';
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        const expectedName = file.replace(/\.md$/, '');
        const locDisplay = isComponent ? `${skill}/examples/${file}` : `${skill}/examples/${reference}/${file}`;
        if (!frontmatter['name'] || typeof frontmatter['name'] !== 'string') {
          invalid.push(`${locDisplay}: missing or invalid "name" in frontmatter`);
        }
        if (frontmatter['name'] && frontmatter['name'] !== expectedName) {
          invalid.push(`${locDisplay}: frontmatter "name" must match filename "${expectedName}"`);
        }
        // Router-layout examples are grouped under a parent reference and MUST
        // declare it. Component-layout examples are flat and do not have one.
        if (!isComponent) {
          if (!frontmatter['reference'] || typeof frontmatter['reference'] !== 'string') {
            invalid.push(`${locDisplay}: missing or invalid "reference" in frontmatter`);
          }
          if (frontmatter['reference'] && frontmatter['reference'] !== reference) {
            invalid.push(
              `${locDisplay}: frontmatter "reference" is "${frontmatter['reference']}" but expected "${reference}"`,
            );
          }
        }
        if (
          !frontmatter['level'] ||
          !(VALID_EXAMPLE_LEVELS as readonly string[]).includes(frontmatter['level'] as string)
        ) {
          invalid.push(
            `${locDisplay}: missing or invalid "level" in frontmatter (must be ${VALID_EXAMPLE_LEVELS.join(', ')})`,
          );
        }
        if (!frontmatter['description'] || typeof frontmatter['description'] !== 'string') {
          invalid.push(`${locDisplay}: missing or invalid "description" in frontmatter`);
        }
        const tags = frontmatter['tags'];
        if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
          invalid.push(`${locDisplay}: missing or invalid "tags" in frontmatter`);
        }
        const features = frontmatter['features'];
        if (
          !Array.isArray(features) ||
          features.length === 0 ||
          features.some((feature) => typeof feature !== 'string' || !feature.trim())
        ) {
          invalid.push(`${locDisplay}: missing or invalid "features" in frontmatter`);
        }
      }
      expect(invalid).toEqual([]);
    });

    it('example frontmatter should stay aligned with the example body', () => {
      const mismatches: string[] = [];
      for (const { skill, reference, file, fullPath } of getAllExampleFiles()) {
        const isComponent = reference === '_top';
        const locDisplay = isComponent ? `${skill}/examples/${file}` : `${skill}/examples/${reference}/${file}`;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { frontmatter } = parseSkillMdFrontmatter(content);
        const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '';
        const features = Array.isArray(frontmatter['features'])
          ? frontmatter['features'].filter((feature): feature is string => typeof feature === 'string')
          : [];
        const firstParagraph = extractFirstParagraph(content);
        const whatThisDemonstrates = extractSectionBullets(content, 'What This Demonstrates');

        if (description !== firstParagraph) {
          mismatches.push(`${locDisplay}: frontmatter "description" must match the first paragraph after the H1`);
        }
        if (JSON.stringify(features) !== JSON.stringify(whatThisDemonstrates)) {
          mismatches.push(`${locDisplay}: frontmatter "features" must match the "What This Demonstrates" bullets`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('manifest example entries should match example file metadata', () => {
      const mismatches: string[] = [];
      // Router-layout key: "<path>/<ref>/<name>"; component-layout key: "<path>/_top/<name>".
      const manifestExampleKeys = new Set<string>();

      // Router-layout entries (entry.references[].examples[]).
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

      // Component-layout entries (entry.examples[] at the top level).
      for (const entry of manifest.skills) {
        if (entry.layout !== 'component') continue;
        const examples = entry.examples ?? [];
        const examplesDir = path.join(CATALOG_DIR, entry.path, 'examples');
        for (const example of examples) {
          manifestExampleKeys.add(`${entry.path}/_top/${example.name}`);
          const exampleFile = path.join(examplesDir, `${example.name}.md`);
          if (!fs.existsSync(exampleFile)) {
            mismatches.push(`${entry.name}/${example.name}.md listed in manifest but missing on disk`);
            continue;
          }
          if (!(VALID_EXAMPLE_LEVELS as readonly string[]).includes(example.level)) {
            mismatches.push(`${entry.name}/${example.name} has invalid level "${example.level}"`);
          }
          if (!Array.isArray(example.tags) || example.tags.length === 0) {
            mismatches.push(`${entry.name}/${example.name} has invalid manifest tags`);
          }
          if (!Array.isArray(example.features) || example.features.length === 0) {
            mismatches.push(`${entry.name}/${example.name} has invalid manifest features`);
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
            mismatches.push(`${entry.name}/${example.name}: manifest description differs from example file`);
          }
          if (example.level !== fileLevel) {
            mismatches.push(`${entry.name}/${example.name}: manifest level differs from example file`);
          }
          if (JSON.stringify(example.tags) !== JSON.stringify(fileTags)) {
            mismatches.push(`${entry.name}/${example.name}: manifest tags differ from example file`);
          }
          if (JSON.stringify(example.features) !== JSON.stringify(fileFeatures)) {
            mismatches.push(`${entry.name}/${example.name}: manifest features differ from example file`);
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

    it('component-layout rule entries should match rule file frontmatter', () => {
      const mismatches: string[] = [];
      const manifestRuleKeys = new Set<string>();

      for (const entry of manifest.skills) {
        if (entry.layout !== 'component') continue;
        const rules = entry.rules ?? [];
        const rulesDir = path.join(CATALOG_DIR, entry.path, 'rules');
        for (const rule of rules) {
          manifestRuleKeys.add(`${entry.path}/${rule.name}`);
          const ruleFile = path.join(rulesDir, `${rule.name}.md`);
          if (!fs.existsSync(ruleFile)) {
            mismatches.push(`${entry.name}/${rule.name}.md listed in manifest but missing on disk`);
            continue;
          }
          if (!rule.constraint || typeof rule.constraint !== 'string') {
            mismatches.push(`${entry.name}/${rule.name}: manifest "constraint" must be a non-empty string`);
          }
          if (rule.severity && !['required', 'recommended'].includes(rule.severity)) {
            mismatches.push(`${entry.name}/${rule.name}: manifest "severity" must be 'required' or 'recommended'`);
          }

          const { frontmatter } = parseSkillMdFrontmatter(fs.readFileSync(ruleFile, 'utf-8'));
          const fileName = typeof frontmatter['name'] === 'string' ? frontmatter['name'] : '';
          const fileConstraint = typeof frontmatter['constraint'] === 'string' ? frontmatter['constraint'] : '';
          const fileSeverity = typeof frontmatter['severity'] === 'string' ? frontmatter['severity'] : undefined;

          if (fileName && fileName !== rule.name) {
            mismatches.push(
              `${entry.name}/${rule.name}: rule file frontmatter "name" is "${fileName}" but expected "${rule.name}"`,
            );
          }
          if (rule.constraint !== fileConstraint) {
            mismatches.push(`${entry.name}/${rule.name}: manifest constraint differs from rule file`);
          }
          if (fileSeverity && fileSeverity !== (rule.severity ?? 'required')) {
            mismatches.push(
              `${entry.name}/${rule.name}: rule file severity "${fileSeverity}" differs from manifest "${rule.severity ?? 'required'}"`,
            );
          }
        }
      }

      for (const { skill, file } of getAllRuleFiles()) {
        const ruleName = file.replace(/\.md$/, '');
        const key = `${skill}/${ruleName}`;
        if (!manifestRuleKeys.has(key)) {
          mismatches.push(`${key}.md exists on disk but is missing from the manifest rules[]`);
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('layout-specific manifest fields should be populated consistently', () => {
      const issues: string[] = [];
      for (const entry of manifest.skills) {
        const layout = entry.layout ?? 'router';
        if (layout === 'component') {
          if (!entry.examples || entry.examples.length === 0) {
            issues.push(`${entry.name}: layout 'component' requires a non-empty top-level examples[]`);
          }
          if (!entry.rules || entry.rules.length === 0) {
            issues.push(
              `${entry.name}: layout 'component' should declare rules[] (component skills exist to bundle DO/DON'T constraints)`,
            );
          }
        } else {
          if (entry.examples && entry.examples.length > 0) {
            issues.push(
              `${entry.name}: layout 'router' must not declare top-level examples[] — group examples under references[].examples[] instead`,
            );
          }
          if (entry.rules && entry.rules.length > 0) {
            issues.push(`${entry.name}: layout 'router' must not declare top-level rules[]`);
          }
        }
      }
      expect(issues).toEqual([]);
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
            // Validate that the href resolves to the expected example file
            if (!row.href) {
              mismatches.push(
                `${entry.name}/${ref.name}/${example.name}: missing href link in reference example table`,
              );
            } else {
              const expectedHref = `../examples/${ref.name}/${example.name}.md`;
              if (row.href !== expectedHref) {
                mismatches.push(
                  `${entry.name}/${ref.name}/${example.name}: href "${row.href}" does not match expected "${expectedHref}"`,
                );
              }
              // Also verify the target file exists on disk
              const resolvedPath = path.resolve(path.dirname(referencePath), row.href);
              if (!fs.existsSync(resolvedPath)) {
                mismatches.push(
                  `${entry.name}/${ref.name}/${example.name}: href target "${row.href}" does not exist on disk`,
                );
              }
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

  describe('catalog ↔ SDK parser consistency', () => {
    function readSkillFile(dir: string): string {
      return fs.readFileSync(path.join(CATALOG_DIR, dir, 'SKILL.md'), 'utf-8');
    }

    it.each(findAllSkillDirs().map((d) => [d]))(
      '"%s" frontmatter category should reach metadata.category (not specMetadata)',
      (dir) => {
        const { frontmatter } = parseSkillMdFrontmatter(readSkillFile(dir));
        // Skip skills that don't declare a category in their frontmatter.
        if (typeof frontmatter['category'] !== 'string') return;

        const md = skillMdFrontmatterToMetadata(frontmatter, '');

        // Regression guard: prior to the parser fix, `category` fell
        // through to `specMetadata` and downstream HTTP catalog filters
        // saw `undefined`.
        expect(md.category).toBe(frontmatter['category']);
        expect(md.specMetadata?.['category']).toBeUndefined();
      },
    );

    it.each(findAllSkillDirs().map((d) => [d]))(
      '"%s" frontmatter priority/visibility/license/tags do not leak into specMetadata',
      (dir) => {
        const { frontmatter } = parseSkillMdFrontmatter(readSkillFile(dir));
        const md = skillMdFrontmatterToMetadata(frontmatter, '');

        for (const k of ['priority', 'visibility', 'license', 'tags', 'name', 'description']) {
          expect(md.specMetadata?.[k]).toBeUndefined();
        }
      },
    );

    it.each(findAllSkillDirs().map((d) => [d]))(
      '"%s" body contains the canonical sections required by TEMPLATE.md',
      (dir) => {
        // Component-layout skills use a different structure (rich frontmatter,
        // Decision Tree / Scenario Routing Table / Inherited Defaults / Rules
        // sections instead of the TEMPLATE.md headings). The structural
        // expectations for them are encoded below in a separate it.each block.
        if (isComponentLayout(dir)) return;
        const body = readSkillFile(dir);
        // Each catalog skill must, at minimum, have these top-level
        // sections so consumers see a uniform structure regardless of
        // which skill they open. (`Examples` and `Accessing This Skill`
        // were added wholesale; the rest were already enforced by the
        // migration tracker for migrated skills.)
        for (const heading of [
          '## When to Use This Skill',
          '## Verification Checklist',
          '## Examples',
          '## Accessing This Skill',
          '## Reference',
        ]) {
          expect(body).toContain(heading);
        }
      },
    );

    it.each(findAllSkillDirs().map((d) => [d]))(
      '"%s" component-layout skills carry the rich-frontmatter shape',
      (dir) => {
        if (!isComponentLayout(dir)) return;
        const body = readSkillFile(dir);
        const { frontmatter } = parseSkillMdFrontmatter(body);
        // These are the auto-trigger hooks Claude Code reads. Component
        // skills must declare all of them — that's the whole point of the
        // new layout.
        expect(typeof frontmatter['description']).toBe('string');
        expect((frontmatter['description'] as string).length).toBeGreaterThan(80);
        expect(typeof frontmatter['when_to_use']).toBe('string');
        expect(typeof frontmatter['paths']).toBe('string');
        expect(frontmatter['layout']).toBe('component');
        // Body still needs a few human-readable sections so the skill is
        // skim-able by a developer, but the section names are intentionally
        // freer than the legacy TEMPLATE.md set.
        for (const heading of ['## Decision tree', '## Scenario routing table', '## References', '## Rules']) {
          expect(body).toContain(heading);
        }
      },
    );

    it.each(findAllSkillDirs().map((d) => [d]))(
      '"%s" Accessing This Skill section names the skill correctly',
      (dir) => {
        // Component skills use a lower-cased `## Accessing this skill`
        // heading; assertion below is case-insensitive for that branch.
        const body = readSkillFile(dir);
        const { frontmatter } = parseSkillMdFrontmatter(body);
        const name = frontmatter['name'];
        if (typeof name !== 'string') return;

        const headingMatch = isComponentLayout(dir)
          ? body.match(/^## Accessing this skill$/im)
          : body.match(/^## Accessing This Skill$/m);
        expect(headingMatch).not.toBeNull();
        const idx = body.indexOf(headingMatch![0]);
        expect(idx).toBeGreaterThanOrEqual(0);
        const section = body.slice(idx);
        const nextHeading = section.indexOf('\n## ', 1);
        const sectionBody = nextHeading > 0 ? section.slice(0, nextHeading) : section;
        expect(sectionBody).toContain(`skill://${name}/SKILL.md`);
      },
    );
  });
});
