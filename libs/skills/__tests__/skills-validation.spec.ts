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
import { VALID_TARGETS, VALID_CATEGORIES, VALID_BUNDLES } from '../src/manifest';

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
    /**
     * Collects all .md files under references/ for all catalog skills.
     */
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
        // Also include the SKILL.md itself
        const skillMd = path.join(CATALOG_DIR, entry, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          results.push({ skill: entry, file: 'SKILL.md', fullPath: skillMd });
        }
      }
      return results;
    }

    it('should not use invalid LLM "adapter" field in code examples', () => {
      const violations: string[] = [];
      for (const { skill, file, fullPath } of getAllReferenceFiles()) {
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
      for (const { skill, file, fullPath } of getAllReferenceFiles()) {
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
      for (const { skill, file, fullPath } of getAllReferenceFiles()) {
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
      for (const { skill, file, fullPath } of getAllReferenceFiles()) {
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
      for (const { skill, file, fullPath } of getAllReferenceFiles()) {
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
