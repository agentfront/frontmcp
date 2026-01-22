/**
 * Plugin Skills Tests
 *
 * Tests for plugin-level skill support, including registration,
 * adoption, and discovery through the skill registry.
 */

import 'reflect-metadata';
import PluginRegistry from '../plugin.registry';
import SkillRegistry from '../../skill/skill.registry';
import { Plugin, Skill, SkillContext, SkillContent, Tool, ToolContext } from '../../common';
import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { skill } from '../../common/decorators/skill.decorator';
import { z } from 'zod';

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

describe('Plugin Skills', () => {
  describe('registration', () => {
    it('should create SkillRegistry for plugin with skills', async () => {
      @Skill({
        name: 'plugin-skill',
        description: 'A skill from plugin',
        instructions: 'Do something in plugin',
      })
      class PluginSkill extends MockSkillContext {}

      @Plugin({
        name: 'test-plugin',
        skills: [PluginSkill],
      })
      class TestPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [TestPlugin], owner);
      await pluginRegistry.ready;

      // Verify plugin was registered
      const plugins = pluginRegistry.getPlugins();
      expect(plugins).toHaveLength(1);

      // Verify SkillRegistry was created and registered with providers
      const skillRegistries = providers.getRegistries('SkillRegistry');
      expect(skillRegistries.length).toBeGreaterThan(0);

      // Find the plugin's skill registry
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.kind === 'plugin' && (r as SkillRegistry).owner.id === 'test-plugin',
      ) as SkillRegistry | undefined;
      expect(pluginSkillRegistry).toBeDefined();

      // Verify the skill is in the plugin's registry
      const skills = pluginSkillRegistry!.getSkills();
      expect(skills.some((s) => s.name === 'plugin-skill')).toBe(true);
    });

    it('should handle plugin without skills (empty registry)', async () => {
      @Plugin({
        name: 'no-skills-plugin',
        description: 'A plugin without skills',
      })
      class NoSkillsPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [NoSkillsPlugin], owner);
      await pluginRegistry.ready;

      // Plugin should still be registered
      const plugins = pluginRegistry.getPlugins();
      expect(plugins).toHaveLength(1);

      // SkillRegistry should be created but empty
      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.kind === 'plugin' && (r as SkillRegistry).owner.id === 'no-skills-plugin',
      ) as SkillRegistry | undefined;
      expect(pluginSkillRegistry).toBeDefined();
      expect(pluginSkillRegistry!.hasAny()).toBe(false);
    });

    it('should register skill registry with parent providers', async () => {
      const inlineSkill = skill({
        name: 'inline-plugin-skill',
        description: 'An inline skill in plugin',
        instructions: 'Follow these plugin steps',
      });

      @Plugin({
        name: 'inline-skills-plugin',
        skills: [inlineSkill],
      })
      class InlineSkillsPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [InlineSkillsPlugin], owner);
      await pluginRegistry.ready;

      // Verify SkillRegistry was added to parent providers
      const skillRegistries = providers.getRegistries('SkillRegistry');
      expect(skillRegistries.length).toBeGreaterThan(0);

      // Find our skill in the plugin's registry
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.kind === 'plugin' && (r as SkillRegistry).owner.id === 'inline-skills-plugin',
      ) as SkillRegistry | undefined;
      expect(pluginSkillRegistry).toBeDefined();
      expect(pluginSkillRegistry!.findByName('inline-plugin-skill')).toBeDefined();
    });
  });

  describe('ownership', () => {
    it('should maintain correct lineage for plugin skills', async () => {
      @Skill({
        name: 'lineage-skill',
        description: 'A skill with lineage',
        instructions: 'Track my lineage',
      })
      class LineageSkill extends MockSkillContext {}

      @Plugin({
        name: 'lineage-plugin',
        skills: [LineageSkill],
      })
      class LineagePlugin {}

      const providers = await createProviderRegistryWithScope();
      const appOwner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [LineagePlugin], appOwner);
      await pluginRegistry.ready;

      // Verify the skill registry was created with correct owner
      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.kind === 'plugin' && (r as SkillRegistry).owner.id === 'lineage-plugin',
      ) as SkillRegistry;

      expect(pluginSkillRegistry).toBeDefined();
      expect(pluginSkillRegistry.owner.kind).toBe('plugin');
      expect(pluginSkillRegistry.owner.id).toBe('lineage-plugin');

      // Verify the skill exists
      const skills = pluginSkillRegistry.getSkills();
      expect(skills.some((s) => s.name === 'lineage-skill')).toBe(true);
    });

    it('should set plugin as owner for plugin skill registry', async () => {
      @Skill({
        name: 'owned-skill',
        description: 'A skill owned by plugin',
        instructions: 'Do owned things',
      })
      class OwnedSkill extends MockSkillContext {}

      @Plugin({
        name: 'owner-plugin',
        skills: [OwnedSkill],
      })
      class OwnerPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [OwnerPlugin], owner);
      await pluginRegistry.ready;

      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'owner-plugin',
      ) as SkillRegistry;

      expect(pluginSkillRegistry.owner.kind).toBe('plugin');
      expect(pluginSkillRegistry.owner.id).toBe('owner-plugin');
    });
  });

  describe('skill content', () => {
    it('should load plugin skill content', async () => {
      @Skill({
        name: 'loadable-plugin-skill',
        description: 'A loadable skill from plugin',
        instructions: 'Step 1: Load me from plugin\nStep 2: Do more',
        tools: ['some-tool'],
      })
      class LoadableSkill extends MockSkillContext {}

      @Plugin({
        name: 'loadable-plugin',
        skills: [LoadableSkill],
      })
      class LoadablePlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [LoadablePlugin], owner);
      await pluginRegistry.ready;

      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'loadable-plugin',
      ) as SkillRegistry;

      // Load should return the plugin skill
      const result = await pluginSkillRegistry.loadSkill('loadable-plugin-skill');
      expect(result).toBeDefined();
      expect(result?.skill.name).toBe('loadable-plugin-skill');
      expect(result?.skill.instructions).toContain('Step 1');
    });

    it('should handle hidden plugin skills', async () => {
      @Skill({
        name: 'visible-plugin-skill',
        description: 'A visible skill',
        instructions: 'I am visible',
      })
      class VisibleSkill extends MockSkillContext {}

      @Skill({
        name: 'hidden-plugin-skill',
        description: 'A hidden skill',
        instructions: 'I am hidden',
        hideFromDiscovery: true,
      })
      class HiddenSkill extends MockSkillContext {}

      @Plugin({
        name: 'mixed-visibility-plugin',
        skills: [VisibleSkill, HiddenSkill],
      })
      class MixedVisibilityPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [MixedVisibilityPlugin], owner);
      await pluginRegistry.ready;

      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'mixed-visibility-plugin',
      ) as SkillRegistry;

      // getSkills without includeHidden should only return visible
      const visibleSkills = pluginSkillRegistry.getSkills(false);
      expect(visibleSkills.some((s) => s.name === 'visible-plugin-skill')).toBe(true);
      expect(visibleSkills.some((s) => s.name === 'hidden-plugin-skill')).toBe(false);

      // getSkills with includeHidden should return both
      const allSkills = pluginSkillRegistry.getSkills(true);
      expect(allSkills.some((s) => s.name === 'visible-plugin-skill')).toBe(true);
      expect(allSkills.some((s) => s.name === 'hidden-plugin-skill')).toBe(true);
    });
  });

  describe('multiple skills', () => {
    it('should handle multiple skills in a single plugin', async () => {
      @Skill({
        name: 'multi-skill-1',
        description: 'First skill',
        instructions: 'Do first thing',
      })
      class Skill1 extends MockSkillContext {}

      @Skill({
        name: 'multi-skill-2',
        description: 'Second skill',
        instructions: 'Do second thing',
      })
      class Skill2 extends MockSkillContext {}

      @Skill({
        name: 'multi-skill-3',
        description: 'Third skill',
        instructions: 'Do third thing',
      })
      class Skill3 extends MockSkillContext {}

      @Plugin({
        name: 'multi-skill-plugin',
        skills: [Skill1, Skill2, Skill3],
      })
      class MultiSkillPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [MultiSkillPlugin], owner);
      await pluginRegistry.ready;

      const skillRegistries = providers.getRegistries('SkillRegistry');
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'multi-skill-plugin',
      ) as SkillRegistry;

      const skills = pluginSkillRegistry.getSkills();
      expect(skills.some((s) => s.name === 'multi-skill-1')).toBe(true);
      expect(skills.some((s) => s.name === 'multi-skill-2')).toBe(true);
      expect(skills.some((s) => s.name === 'multi-skill-3')).toBe(true);
      expect(skills).toHaveLength(3);
    });

    it('should handle skills in multiple plugins', async () => {
      @Skill({
        name: 'skill-from-a',
        description: 'A skill from plugin A',
        instructions: 'Do A things',
      })
      class SkillFromA extends MockSkillContext {}

      @Skill({
        name: 'skill-from-b',
        description: 'A skill from plugin B',
        instructions: 'Do B things',
      })
      class SkillFromB extends MockSkillContext {}

      @Plugin({
        name: 'plugin-a',
        skills: [SkillFromA],
      })
      class PluginA {}

      @Plugin({
        name: 'plugin-b',
        skills: [SkillFromB],
      })
      class PluginB {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [PluginA, PluginB], owner);
      await pluginRegistry.ready;

      const skillRegistries = providers.getRegistries('SkillRegistry');

      const registryA = skillRegistries.find((r) => (r as SkillRegistry).owner.id === 'plugin-a') as SkillRegistry;
      const registryB = skillRegistries.find((r) => (r as SkillRegistry).owner.id === 'plugin-b') as SkillRegistry;

      expect(registryA).toBeDefined();
      expect(registryB).toBeDefined();
      expect(registryA.findByName('skill-from-a')).toBeDefined();
      expect(registryB.findByName('skill-from-b')).toBeDefined();
    });
  });

  describe('nested plugins', () => {
    it('should handle nested plugins with skills', async () => {
      @Skill({
        name: 'nested-skill',
        description: 'A skill from nested plugin',
        instructions: 'Do nested things',
      })
      class NestedSkill extends MockSkillContext {}

      @Plugin({
        name: 'inner-plugin',
        skills: [NestedSkill],
      })
      class InnerPlugin {}

      @Skill({
        name: 'outer-skill',
        description: 'A skill from outer plugin',
        instructions: 'Do outer things',
      })
      class OuterSkill extends MockSkillContext {}

      @Plugin({
        name: 'outer-plugin',
        plugins: [InnerPlugin],
        skills: [OuterSkill],
      })
      class OuterPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [OuterPlugin], owner);
      await pluginRegistry.ready;

      // The outer plugin's skill registry should be registered with parent providers
      const skillRegistries = providers.getRegistries('SkillRegistry');

      // Find outer plugin's skill registry
      const outerSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'outer-plugin',
      ) as SkillRegistry;

      expect(outerSkillRegistry).toBeDefined();
      expect(outerSkillRegistry.findByName('outer-skill')).toBeDefined();

      // The outer plugin's skill registry should have adopted skills from inner plugin
      // via the registry adoption mechanism
      const allSkills = outerSkillRegistry.getSkills();
      expect(allSkills.some((s) => s.name === 'outer-skill')).toBe(true);
      expect(allSkills.some((s) => s.name === 'nested-skill')).toBe(true);
    });
  });

  describe('mixed components', () => {
    it('should handle plugin with both tools and skills', async () => {
      const inputSchema = z.object({ name: z.string() });

      @Tool({
        name: 'plugin-tool',
        description: 'A tool from plugin',
        inputSchema,
      })
      class PluginTool extends ToolContext<typeof inputSchema> {
        async execute() {
          return { success: true };
        }
      }

      @Skill({
        name: 'plugin-skill-with-tool',
        description: 'A skill that uses the plugin tool',
        instructions: 'Use plugin-tool to do something',
        tools: ['plugin-tool'],
      })
      class PluginSkillWithTool extends MockSkillContext {}

      @Plugin({
        name: 'mixed-plugin',
        tools: [PluginTool],
        skills: [PluginSkillWithTool],
      })
      class MixedPlugin {}

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const pluginRegistry = new PluginRegistry(providers, [MixedPlugin], owner);
      await pluginRegistry.ready;

      // Both tool and skill registries should be created
      const toolRegistries = providers.getRegistries('ToolRegistry');
      const skillRegistries = providers.getRegistries('SkillRegistry');

      expect(toolRegistries.length).toBeGreaterThan(0);
      expect(skillRegistries.length).toBeGreaterThan(0);

      // Find the specific registries
      const pluginSkillRegistry = skillRegistries.find(
        (r) => (r as SkillRegistry).owner.id === 'mixed-plugin',
      ) as SkillRegistry;

      expect(pluginSkillRegistry).toBeDefined();
      expect(pluginSkillRegistry.findByName('plugin-skill-with-tool')).toBeDefined();
    });
  });
});
