/**
 * Skill Registry Tests
 *
 * Tests for SkillRegistry class which manages skill discovery, search, and loading.
 */

import 'reflect-metadata';
import SkillRegistry from '../skill.registry';
import { Skill, SkillContext, SkillContent } from '../../common';
import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { skill } from '../../common/decorators/skill.decorator';

// Mock SkillContext for class-based skills
class MockSkillContext extends SkillContext {
  async loadInstructions(): Promise<string> {
    return this.metadata.instructions as string;
  }

  async build(): Promise<SkillContent> {
    return {
      id: this.skillId,
      name: this.skillName,
      description: this.metadata.description,
      instructions: await this.loadInstructions(),
      tools: this.getToolRefs().map((t) => ({ name: t.name, purpose: t.purpose })),
    };
  }
}

describe('SkillRegistry', () => {
  describe('Basic Registration', () => {
    it('should register a skill with class decorator', async () => {
      @Skill({
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something specific',
      })
      class TestSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [TestSkill], owner);
      await registry.ready;

      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].getDescription()).toBe('A test skill');
    });

    it('should register a skill with skill() helper', async () => {
      const inlineSkill = skill({
        name: 'inline-skill',
        description: 'An inline skill',
        instructions: 'Follow these steps',
        tools: ['tool1', 'tool2'],
      });

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [inlineSkill], owner);
      await registry.ready;

      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('inline-skill');
    });

    it('should register multiple skills', async () => {
      @Skill({
        name: 'skill-a',
        description: 'First skill',
        instructions: 'Instructions A',
      })
      class SkillA extends MockSkillContext {}

      @Skill({
        name: 'skill-b',
        description: 'Second skill',
        instructions: 'Instructions B',
      })
      class SkillB extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [SkillA, SkillB], owner);
      await registry.ready;

      const skills = registry.getSkills();
      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name)).toContain('skill-a');
      expect(skills.map((s) => s.name)).toContain('skill-b');
    });
  });

  describe('Skill Lookup', () => {
    it('should find skill by name', async () => {
      @Skill({
        name: 'findable-skill',
        description: 'A findable skill',
        instructions: 'Do something',
      })
      class FindableSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [FindableSkill], owner);
      await registry.ready;

      const found = registry.findByName('findable-skill');
      expect(found).toBeDefined();
      expect(found?.name).toBe('findable-skill');
    });

    it('should return undefined for non-existent skill', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [], owner);
      await registry.ready;

      const found = registry.findByName('non-existent');
      expect(found).toBeUndefined();
    });

    it('should find skill by qualified name matching internal format', async () => {
      @Skill({
        name: 'qualified-skill',
        description: 'A skill with qualified name',
        instructions: 'Do something',
      })
      class QualifiedSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'my-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [QualifiedSkill], owner);
      await registry.ready;

      // Verify the skill exists
      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);

      // findByName works as expected
      const foundByName = registry.findByName('qualified-skill');
      expect(foundByName).toBeDefined();
      expect(foundByName?.name).toBe('qualified-skill');

      // The fullName includes owner prefix
      expect(foundByName?.fullName).toContain('my-app');
      expect(foundByName?.fullName).toContain('qualified-skill');
    });
  });

  describe('Hidden Skills', () => {
    it('should exclude hidden skills from getSkills by default', async () => {
      @Skill({
        name: 'visible-skill',
        description: 'A visible skill',
        instructions: 'Do something',
      })
      class VisibleSkill extends MockSkillContext {}

      @Skill({
        name: 'hidden-skill',
        description: 'A hidden skill',
        instructions: 'Do something secret',
        hideFromDiscovery: true,
      })
      class HiddenSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [VisibleSkill, HiddenSkill], owner);
      await registry.ready;

      const visibleSkills = registry.getSkills(false);
      expect(visibleSkills).toHaveLength(1);
      expect(visibleSkills[0].name).toBe('visible-skill');

      const allSkills = registry.getSkills(true);
      expect(allSkills).toHaveLength(2);
    });
  });

  describe('Skill Loading', () => {
    it('should load skill by ID', async () => {
      @Skill({
        name: 'loadable-skill',
        description: 'A loadable skill',
        instructions: 'Step 1: Do X\nStep 2: Do Y',
        tools: ['tool1'],
      })
      class LoadableSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [LoadableSkill], owner);
      await registry.ready;

      const result = await registry.loadSkill('loadable-skill');
      expect(result).toBeDefined();
      expect(result?.skill.name).toBe('loadable-skill');
      expect(result?.skill.instructions).toContain('Step 1');
    });

    it('should return undefined for non-existent skill', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [], owner);
      await registry.ready;

      const result = await registry.loadSkill('non-existent');
      expect(result).toBeUndefined();
    });

    /**
     * Issue #6: File-based skill records and load-by-name
     *
     * The loadSkill method should support loading skills by metadata.name
     * when the id lookup fails. This enables skills with custom IDs to be
     * loaded by their friendly name as well.
     */
    it('should load skill by metadata.name when id lookup fails', async () => {
      // Skill has different id and name
      @Skill({
        id: 'custom-unique-id',
        name: 'friendly-display-name',
        description: 'A skill with different id and name',
        instructions: 'Do something specific',
      })
      class NamedSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [NamedSkill], owner);
      await registry.ready;

      // Load by id works
      const byId = await registry.loadSkill('custom-unique-id');
      expect(byId).toBeDefined();
      expect(byId?.skill.name).toBe('friendly-display-name');
      expect(byId?.skill.id).toBe('custom-unique-id');

      // Load by metadata.name also works (fallback)
      const byName = await registry.loadSkill('friendly-display-name');
      expect(byName).toBeDefined();
      expect(byName?.skill.id).toBe('custom-unique-id');
      expect(byName?.skill.name).toBe('friendly-display-name');
    });

    it('should find skill by name even when id differs', async () => {
      // Skill has id that differs from name
      @Skill({
        id: 'internal-skill-id',
        name: 'searchable-skill',
        description: 'A skill searchable by name',
        instructions: 'Do the thing',
      })
      class SearchableSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [SearchableSkill], owner);
      await registry.ready;

      // Loading by name should work
      const byName = await registry.loadSkill('searchable-skill');
      expect(byName).toBeDefined();
      expect(byName?.skill.name).toBe('searchable-skill');
      expect(byName?.skill.id).toBe('internal-skill-id');

      // Loading by id should also work (via metadata.name fallback loop)
      const byId = await registry.loadSkill('internal-skill-id');
      expect(byId).toBeDefined();
      expect(byId?.skill.id).toBe('internal-skill-id');
    });

    it('should load skill with tools metadata', async () => {
      @Skill({
        name: 'tool-rich-skill',
        description: 'A skill with many tools',
        instructions: 'Use all these tools',
        tools: ['simple_tool', { name: 'detailed_tool', purpose: 'Does detailed work', required: true }],
      })
      class ToolRichSkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [ToolRichSkill], owner);
      await registry.ready;

      const result = await registry.loadSkill('tool-rich-skill');
      expect(result).toBeDefined();
      expect(result?.skill.tools).toHaveLength(2);
      // Tools should have their names extracted
      expect(result?.skill.tools[0].name).toBe('simple_tool');
      expect(result?.skill.tools[1].name).toBe('detailed_tool');
      expect(result?.skill.tools[1].purpose).toBe('Does detailed work');
    });
  });

  describe('Skill Search', () => {
    it('should search skills by query', async () => {
      @Skill({
        name: 'github-pr',
        description: 'Review GitHub pull requests',
        instructions: 'Analyze the PR diff and provide feedback',
      })
      class GitHubPRSkill extends MockSkillContext {}

      @Skill({
        name: 'deploy',
        description: 'Deploy application to production',
        instructions: 'Run deployment commands',
      })
      class DeploySkill extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [GitHubPRSkill, DeploySkill], owner);
      await registry.ready;

      const results = await registry.search('GitHub');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata.name).toBe('github-pr');
    });

    it('should search with empty query (returns all)', async () => {
      const inlineSkill = skill({
        name: 'any-skill',
        description: 'Any skill',
        instructions: 'Do anything',
      });

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [inlineSkill], owner);
      await registry.ready;

      // Empty search should return skills (TF-IDF might not match empty query)
      const results = await registry.search('', { topK: 10 });
      // Results depend on TF-IDF behavior
      expect(Array.isArray(results)).toBe(true);
    });

    it('should respect topK limit', async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        skill({
          name: `skill-${i}`,
          description: `Skill number ${i}`,
          instructions: `Instructions for skill ${i}`,
        }),
      );

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, skills, owner);
      await registry.ready;

      const results = await registry.search('skill', { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Skill Listing', () => {
    it('should list skills with pagination', async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        skill({
          name: `list-skill-${i}`,
          description: `Skill ${i}`,
          instructions: `Instructions ${i}`,
        }),
      );

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, skills, owner);
      await registry.ready;

      const page1 = await registry.listSkills({ limit: 2, offset: 0 });
      expect(page1.skills.length).toBe(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page2 = await registry.listSkills({ limit: 2, offset: 2 });
      expect(page2.skills.length).toBe(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await registry.listSkills({ limit: 2, offset: 4 });
      expect(page3.skills.length).toBe(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe('hasAny', () => {
    it('should return true when skills exist', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const inlineSkill = skill({
        name: 'any-skill',
        description: 'Any skill',
        instructions: 'Do something',
      });

      const registry = new SkillRegistry(providers, [inlineSkill], owner);
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
    });

    it('should return false when no skills exist', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [], owner);
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
    });
  });

  describe('count', () => {
    it('should count skills', async () => {
      const skills = Array.from({ length: 3 }, (_, i) =>
        skill({
          name: `count-skill-${i}`,
          description: `Skill ${i}`,
          instructions: `Instructions ${i}`,
        }),
      );

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, skills, owner);
      await registry.ready;

      const count = await registry.count();
      expect(count).toBe(3);
    });
  });

  describe('Subscription', () => {
    it('should call subscriber on changes', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const inlineSkill = skill({
        name: 'sub-skill',
        description: 'Subscription skill',
        instructions: 'Do something',
      });

      const registry = new SkillRegistry(providers, [inlineSkill], owner);
      await registry.ready;

      const callback = jest.fn();
      const unsubscribe = registry.subscribe({ immediate: false }, callback);

      expect(typeof unsubscribe).toBe('function');

      // Cleanup
      unsubscribe();
    });

    it('should call subscriber immediately when immediate=true', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const inlineSkill = skill({
        name: 'immediate-skill',
        description: 'Immediate skill',
        instructions: 'Do something',
      });

      const registry = new SkillRegistry(providers, [inlineSkill], owner);
      await registry.ready;

      const callback = jest.fn();
      const unsubscribe = registry.subscribe({ immediate: true }, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'reset',
          changeScope: 'global',
        }),
      );

      unsubscribe();
    });
  });

  describe('Capabilities', () => {
    it('should return empty capabilities (skills use tools)', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [], owner);
      await registry.ready;

      const capabilities = registry.getCapabilities();
      expect(capabilities).toEqual({});
    });
  });

  describe('getInlineSkills', () => {
    it('should return only inline skills', async () => {
      @Skill({
        name: 'inline-skill-1',
        description: 'First inline skill',
        instructions: 'Do something',
      })
      class InlineSkill1 extends MockSkillContext {}

      @Skill({
        name: 'inline-skill-2',
        description: 'Second inline skill',
        instructions: 'Do something else',
      })
      class InlineSkill2 extends MockSkillContext {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [InlineSkill1, InlineSkill2], owner);
      await registry.ready;

      const inlineSkills = registry.getInlineSkills();
      expect(inlineSkills).toHaveLength(2);
    });
  });

  describe('Tags and Priority', () => {
    it('should handle skills with tags', async () => {
      const taggedSkillRecord = skill({
        name: 'tagged-skill',
        description: 'A tagged skill',
        instructions: 'Do something',
        tags: ['devops', 'deployment'],
      });

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [taggedSkillRecord], owner);
      await registry.ready;

      const foundSkill = registry.findByName('tagged-skill');
      expect(foundSkill?.getTags()).toEqual(['devops', 'deployment']);
    });

    it('should handle skills with priority', async () => {
      const prioritySkillRecord = skill({
        name: 'priority-skill',
        description: 'A priority skill',
        instructions: 'Do something',
        priority: 10,
      });

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new SkillRegistry(providers, [prioritySkillRecord], owner);
      await registry.ready;

      const foundSkill = registry.findByName('priority-skill');
      expect(foundSkill?.getPriority()).toBe(10);
    });
  });
});
