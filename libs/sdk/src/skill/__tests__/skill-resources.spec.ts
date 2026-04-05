/**
 * Skill Resources Tests
 *
 * Tests for the skills:// MCP resource classes and registration.
 */

import 'reflect-metadata';
import { getSkillResources } from '../resources';

describe('skill resources', () => {
  describe('getSkillResources', () => {
    it('should return all 7 resource classes', () => {
      const resources = getSkillResources();
      expect(resources).toHaveLength(7);
    });

    it('should return unique classes', () => {
      const resources = getSkillResources();
      const unique = new Set(resources);
      expect(unique.size).toBe(7);
    });

    it('should return classes with names', () => {
      const resources = getSkillResources();
      const names = resources.map((r) => (r as any).name);
      expect(names).toContain('SkillsCatalogResource');
      expect(names).toContain('SkillContentResource');
      expect(names).toContain('SkillContentAliasResource');
      expect(names).toContain('SkillReferencesListResource');
      expect(names).toContain('SkillReferenceContentResource');
      expect(names).toContain('SkillExamplesListResource');
      expect(names).toContain('SkillExampleContentResource');
    });
  });
});
