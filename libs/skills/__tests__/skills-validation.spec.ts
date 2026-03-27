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
  const categories = fs.readdirSync(CATALOG_DIR).filter((f) => {
    const full = path.join(CATALOG_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'node_modules';
  });

  for (const cat of categories) {
    const catDir = path.join(CATALOG_DIR, cat);
    const skills = fs.readdirSync(catDir).filter((f) => {
      const full = path.join(catDir, f);
      return fs.statSync(full).isDirectory();
    });
    for (const skill of skills) {
      const skillDir = path.join(catDir, skill);
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        dirs.push(`${cat}/${skill}`);
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
    )('"%s" should have valid install config', (_, entry) => {
      expect(entry.install).toBeDefined();
      expect(entry.install.destinations.length).toBeGreaterThan(0);
      expect(['overwrite', 'skip-existing']).toContain(entry.install.mergeStrategy);
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
        if (entry.install.dependencies) {
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

  describe('new-format migration tracking', () => {
    const NEW_FORMAT_SECTIONS = [{ heading: '## When to Use This Skill', required: '### Must Use' }];

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
