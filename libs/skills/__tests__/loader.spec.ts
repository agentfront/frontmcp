/**
 * Skills catalog loader tests.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getInstructionOnlySkills,
  getResourceSkills,
  getSkillsByBundle,
  getSkillsByCategory,
  getSkillsByTarget,
  loadManifest,
  resolveSkillPath,
} from '../src/loader';
import type { SkillCatalogEntry } from '../src/manifest';

const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');

const makeEntry = (overrides: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry => ({
  name: 'test-skill',
  category: 'development',
  description: 'A test skill',
  path: 'development/test-skill',
  targets: ['all'],
  hasResources: false,
  tags: ['test'],
  bundle: ['recommended'],
  install: {
    destinations: ['project-local'],
    mergeStrategy: 'overwrite',
  },
  ...overrides,
});

describe('loader', () => {
  describe('loadManifest', () => {
    it('should load the bundled manifest', () => {
      const manifest = loadManifest(CATALOG_DIR);
      expect(manifest).toBeDefined();
      expect(manifest.version).toBe(1);
      expect(Array.isArray(manifest.skills)).toBe(true);
    });

    describe('reads the manifest file as data and never runs code from the catalog', () => {
      const ranMarker = '__frontmcpSkillsManifestCodeRan';

      afterEach(() => {
        delete (globalThis as Record<string, unknown>)[ranMarker];
      });

      it('when skills-manifest.json is a folder with an index.js', () => {
        const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-catalog-'));
        fs.mkdirSync(path.join(catalogDir, 'skills-manifest.json'));
        fs.writeFileSync(
          path.join(catalogDir, 'skills-manifest.json', 'index.js'),
          `globalThis.${ranMarker} = true; module.exports = { version: 1, skills: [] };`,
        );

        expect(() => loadManifest(catalogDir)).toThrow();
        expect((globalThis as Record<string, unknown>)[ranMarker]).toBeUndefined();
      });

      it('when only skills-manifest.json.js exists', () => {
        const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-catalog-'));
        fs.writeFileSync(
          path.join(catalogDir, 'skills-manifest.json.js'),
          `globalThis.${ranMarker} = true; module.exports = { version: 1, skills: [] };`,
        );

        expect(() => loadManifest(catalogDir)).toThrow();
        expect((globalThis as Record<string, unknown>)[ranMarker]).toBeUndefined();
      });

      it('loads a manifest file in another catalog folder', () => {
        const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-catalog-'));
        fs.writeFileSync(path.join(catalogDir, 'skills-manifest.json'), '{ "version": 1, "skills": [] }');

        expect(loadManifest(catalogDir)).toEqual({ version: 1, skills: [] });
      });
    });
  });

  describe('getSkillsByTarget', () => {
    const skills = [
      makeEntry({ name: 'all-skill', targets: ['all'] }),
      makeEntry({ name: 'node-skill', targets: ['node'] }),
      makeEntry({ name: 'vercel-skill', targets: ['vercel'] }),
      makeEntry({ name: 'multi-skill', targets: ['node', 'vercel'] }),
    ];

    it('should return skills matching the target', () => {
      const result = getSkillsByTarget(skills, 'node');
      expect(result.map((s) => s.name)).toEqual(['all-skill', 'node-skill', 'multi-skill']);
    });

    it('should include all-target skills for any target', () => {
      const result = getSkillsByTarget(skills, 'lambda');
      expect(result.map((s) => s.name)).toEqual(['all-skill']);
    });

    it('should return empty for unknown target', () => {
      const result = getSkillsByTarget(skills, 'browser');
      expect(result.map((s) => s.name)).toEqual(['all-skill']);
    });
  });

  describe('getSkillsByCategory', () => {
    const skills = [
      makeEntry({ name: 'setup-a', category: 'setup' }),
      makeEntry({ name: 'deploy-a', category: 'deployment' }),
      makeEntry({ name: 'setup-b', category: 'setup' }),
    ];

    it('should filter by category', () => {
      const result = getSkillsByCategory(skills, 'setup');
      expect(result.map((s) => s.name)).toEqual(['setup-a', 'setup-b']);
    });

    it('should return empty for missing category', () => {
      expect(getSkillsByCategory(skills, 'auth')).toEqual([]);
    });
  });

  describe('getSkillsByBundle', () => {
    const skills = [
      makeEntry({ name: 'recommended-a', bundle: ['recommended'] }),
      makeEntry({ name: 'minimal-a', bundle: ['minimal', 'recommended'] }),
      makeEntry({ name: 'full-only', bundle: ['full'] }),
      makeEntry({ name: 'no-bundle', bundle: undefined }),
    ];

    it('should filter by bundle', () => {
      const result = getSkillsByBundle(skills, 'recommended');
      expect(result.map((s) => s.name)).toEqual(['recommended-a', 'minimal-a']);
    });

    it('should exclude skills without bundle', () => {
      const result = getSkillsByBundle(skills, 'full');
      expect(result.map((s) => s.name)).toEqual(['full-only']);
    });

    it('should treat an empty bundle array as not matching', () => {
      const empty = [makeEntry({ name: 'no-tags', bundle: [] as SkillCatalogEntry['bundle'] })];
      expect(getSkillsByBundle(empty, 'recommended')).toEqual([]);
    });

    it('returns no matches when no skill has the queried bundle', () => {
      const result = getSkillsByBundle(skills, 'nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('getInstructionOnlySkills', () => {
    const skills = [
      makeEntry({ name: 'instruction-only', hasResources: false }),
      makeEntry({ name: 'with-resources', hasResources: true }),
    ];

    it('should return skills without resources', () => {
      const result = getInstructionOnlySkills(skills);
      expect(result.map((s) => s.name)).toEqual(['instruction-only']);
    });
  });

  describe('getResourceSkills', () => {
    const skills = [
      makeEntry({ name: 'instruction-only', hasResources: false }),
      makeEntry({ name: 'with-resources', hasResources: true }),
    ];

    it('should return skills with resources', () => {
      const result = getResourceSkills(skills);
      expect(result.map((s) => s.name)).toEqual(['with-resources']);
    });
  });

  describe('resolveSkillPath', () => {
    it('should resolve path relative to catalog dir', () => {
      const entry = makeEntry({ path: 'development/my-tool' });
      const result = resolveSkillPath(entry, '/some/catalog');
      expect(result).toBe(path.resolve('/some/catalog', 'development/my-tool'));
    });

    it('should use default catalog dir when not specified', () => {
      const entry = makeEntry({ path: 'setup/my-setup' });
      const result = resolveSkillPath(entry);
      // Should resolve relative to the src/../catalog directory
      expect(result).toContain('setup/my-setup');
    });
  });
});
