/**
 * Memory Skill Provider Tests
 *
 * Tests for in-memory skill storage provider with TF-IDF search.
 */

import { MemorySkillProvider } from '../providers/memory-skill.provider';
import { SkillToolValidator } from '../skill-validator';
import { SkillContent } from '../../common/interfaces';
import { ToolRegistryInterface } from '../../common/interfaces/internal';
import { ToolEntry } from '../../common';

// Helper to create test skills
const createTestSkill = (
  overrides: Partial<SkillContent & { tags?: string[]; priority?: number; hideFromDiscovery?: boolean }> = {},
): SkillContent & { tags?: string[]; priority?: number; hideFromDiscovery?: boolean } => ({
  id: 'test-skill',
  name: 'Test Skill',
  description: 'A test skill for testing',
  instructions: 'Step 1: Do something\nStep 2: Do another thing',
  tools: [{ name: 'tool1' }, { name: 'tool2', purpose: 'Does something' }],
  ...overrides,
});

// Mock tool registry
const createMockToolRegistry = (tools: string[]): ToolRegistryInterface =>
  ({
    getTools: () =>
      tools.map(
        (name) =>
          ({
            name,
            metadata: { name, description: '', inputSchema: {}, outputSchema: {}, hideFromDiscovery: false },
            isHidden: () => false,
          }) as unknown as ToolEntry,
      ),
    findByName: jest.fn(),
    findByQualifiedName: jest.fn(),
    hasAny: jest.fn(),
    subscribe: jest.fn(),
    getCapabilities: jest.fn(),
    getInlineTools: jest.fn(),
    owner: { kind: 'scope', id: 'test', ref: {} },
  }) as unknown as ToolRegistryInterface;

describe('MemorySkillProvider', () => {
  let provider: MemorySkillProvider;

  beforeEach(async () => {
    provider = new MemorySkillProvider();
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('initialization', () => {
    it('should initialize with default options', async () => {
      expect(provider.type).toBe('memory');
    });

    it('should accept custom options', async () => {
      const customProvider = new MemorySkillProvider({
        defaultTopK: 5,
        defaultMinScore: 0.5,
      });
      await customProvider.initialize();

      expect(customProvider.type).toBe('memory');
      await customProvider.dispose();
    });

    it('should accept tool validator', async () => {
      const registry = createMockToolRegistry(['tool1', 'tool2']);
      const validator = new SkillToolValidator(registry);

      const customProvider = new MemorySkillProvider({
        toolValidator: validator,
      });
      await customProvider.initialize();

      expect(customProvider.type).toBe('memory');
      await customProvider.dispose();
    });
  });

  describe('add/load', () => {
    it('should add and load a skill', async () => {
      const skill = createTestSkill({ id: 'skill-1' });
      await provider.add(skill);

      const result = await provider.load('skill-1');

      expect(result).not.toBeNull();
      expect(result?.skill.id).toBe('skill-1');
      expect(result?.skill.name).toBe('Test Skill');
    });

    it('should return null for non-existent skill', async () => {
      const result = await provider.load('non-existent');

      expect(result).toBeNull();
    });

    it('should validate tools when loading', async () => {
      const registry = createMockToolRegistry(['tool1']); // Only tool1 available
      const validator = new SkillToolValidator(registry);
      provider.setToolValidator(validator);

      const skill = createTestSkill({
        id: 'skill-with-tools',
        tools: [{ name: 'tool1' }, { name: 'tool2' }],
      });
      await provider.add(skill);

      const result = await provider.load('skill-with-tools');

      expect(result?.availableTools).toEqual(['tool1']);
      expect(result?.missingTools).toEqual(['tool2']);
      expect(result?.isComplete).toBe(false);
      expect(result?.warning).toBeDefined();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add multiple skills for search tests
      await provider.addMany([
        createTestSkill({
          id: 'github-pr',
          name: 'Review GitHub PR',
          description: 'Review and analyze pull requests on GitHub',
          tools: [{ name: 'gh-cli' }],
          tags: ['github', 'code-review'],
        }),
        createTestSkill({
          id: 'deploy-app',
          name: 'Deploy Application',
          description: 'Deploy application to production servers',
          tools: [{ name: 'kubectl' }, { name: 'docker' }],
          tags: ['devops', 'deployment'],
        }),
        createTestSkill({
          id: 'write-tests',
          name: 'Write Unit Tests',
          description: 'Write comprehensive unit tests for code',
          tools: [{ name: 'jest' }],
          tags: ['testing', 'code-quality'],
        }),
      ] as SkillContent[]);
    });

    it('should search for skills by query', async () => {
      const results = await provider.search('pull request');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata.name).toBe('Review GitHub PR');
      expect(results[0].source).toBe('local');
    });

    it('should return scores with results', async () => {
      const results = await provider.search('GitHub');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should respect topK limit', async () => {
      const results = await provider.search('code', { topK: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should filter by tags', async () => {
      const results = await provider.search('', { tags: ['devops'] });

      expect(results.every((r) => r.metadata.name === 'Deploy Application')).toBe(true);
    });

    it('should filter by tools', async () => {
      const results = await provider.search('', { tools: ['jest'] });

      expect(results.every((r) => r.metadata.name === 'Write Unit Tests')).toBe(true);
    });

    it('should exclude specific IDs', async () => {
      const results = await provider.search('', { excludeIds: ['github-pr'] });

      expect(results.find((r) => r.metadata.id === 'github-pr')).toBeUndefined();
    });

    it('should validate tools in results when validator is set', async () => {
      const registry = createMockToolRegistry(['gh-cli', 'jest']); // kubectl, docker not available
      const validator = new SkillToolValidator(registry);
      provider.setToolValidator(validator);

      const results = await provider.search('deploy');

      const deployResult = results.find((r) => r.metadata.id === 'deploy-app');
      expect(deployResult?.missingTools).toContain('kubectl');
      expect(deployResult?.missingTools).toContain('docker');
    });

    it('should filter by requireAllTools', async () => {
      const registry = createMockToolRegistry(['gh-cli', 'jest']); // kubectl, docker not available
      const validator = new SkillToolValidator(registry);
      provider.setToolValidator(validator);

      const results = await provider.search('', { requireAllTools: true });

      // Deploy app should be excluded because it has missing tools
      expect(results.find((r) => r.metadata.id === 'deploy-app')).toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await provider.addMany([
        createTestSkill({ id: 'skill-a', name: 'Skill A', priority: 1 }),
        createTestSkill({ id: 'skill-b', name: 'Skill B', priority: 3 }),
        createTestSkill({ id: 'skill-c', name: 'Skill C', priority: 2, hideFromDiscovery: true }),
        createTestSkill({ id: 'skill-d', name: 'Skill D', tags: ['special'] }),
      ] as SkillContent[]);
    });

    it('should list all non-hidden skills', async () => {
      const result = await provider.list();

      expect(result.skills.length).toBe(3); // skill-c is hidden
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should include hidden skills when includeHidden is true', async () => {
      const result = await provider.list({ includeHidden: true });

      expect(result.skills.length).toBe(4);
      expect(result.total).toBe(4);
    });

    it('should sort by name ascending by default', async () => {
      const result = await provider.list();

      const names = result.skills.map((s) => s.name);
      expect(names).toEqual([...names].sort());
    });

    it('should sort by name descending', async () => {
      const result = await provider.list({ sortBy: 'name', sortOrder: 'desc' });

      const names = result.skills.map((s) => s.name);
      expect(names).toEqual([...names].sort().reverse());
    });

    it('should sort by priority', async () => {
      const result = await provider.list({ sortBy: 'priority', includeHidden: true });

      // Skill D has no priority (undefined/0), then Skill A (1), Skill C (2), Skill B (3)
      // When sortBy priority ascending, undefined/0 comes first
      expect(result.skills.map((s) => s.name)).toEqual(['Skill D', 'Skill A', 'Skill C', 'Skill B']);
    });

    it('should paginate results', async () => {
      const result = await provider.list({ limit: 2 });

      expect(result.skills.length).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    it('should support offset', async () => {
      const page1 = await provider.list({ limit: 2, offset: 0 });
      const page2 = await provider.list({ limit: 2, offset: 2 });

      expect(page1.skills[0].name).not.toBe(page2.skills[0]?.name);
    });

    it('should filter by tags', async () => {
      const result = await provider.list({ tags: ['special'] });

      expect(result.skills.length).toBe(1);
      expect(result.skills[0].name).toBe('Skill D');
    });
  });

  describe('exists', () => {
    it('should return true for existing skill', async () => {
      await provider.add(createTestSkill({ id: 'existing' }));

      expect(await provider.exists('existing')).toBe(true);
    });

    it('should return false for non-existing skill', async () => {
      expect(await provider.exists('non-existing')).toBe(false);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await provider.addMany([
        createTestSkill({ id: 'skill-1', tags: ['tag-a'] }),
        createTestSkill({ id: 'skill-2', tags: ['tag-a', 'tag-b'] }),
        createTestSkill({ id: 'skill-3', tags: ['tag-b'], hideFromDiscovery: true }),
      ] as SkillContent[]);
    });

    it('should count non-hidden skills', async () => {
      expect(await provider.count()).toBe(2);
    });

    it('should include hidden when specified', async () => {
      expect(await provider.count({ includeHidden: true })).toBe(3);
    });

    it('should filter by tags', async () => {
      expect(await provider.count({ tags: ['tag-a'] })).toBe(2);
      expect(await provider.count({ tags: ['tag-b'] })).toBe(1); // hidden excluded
      expect(await provider.count({ tags: ['tag-b'], includeHidden: true })).toBe(2);
    });
  });

  describe('update', () => {
    it('should update an existing skill', async () => {
      await provider.add(createTestSkill({ id: 'update-me', name: 'Original Name' }));

      await provider.update('update-me', createTestSkill({ id: 'update-me', name: 'Updated Name' }));

      const result = await provider.load('update-me');
      expect(result?.skill.name).toBe('Updated Name');
    });

    it('should be loadable after update', async () => {
      await provider.add(
        createTestSkill({
          id: 'update-search',
          name: 'Old Name',
          description: 'Old description',
        }),
      );

      await provider.update(
        'update-search',
        createTestSkill({
          id: 'update-search',
          name: 'New Name',
          description: 'Completely new description',
        }),
      );

      // Verify the skill was updated and is loadable
      const loaded = await provider.load('update-search');
      expect(loaded?.skill.name).toBe('New Name');
      expect(loaded?.skill.description).toBe('Completely new description');
    });
  });

  describe('remove', () => {
    it('should remove a skill', async () => {
      await provider.add(createTestSkill({ id: 'remove-me' }));

      await provider.remove('remove-me');

      expect(await provider.exists('remove-me')).toBe(false);
      expect(await provider.load('remove-me')).toBeNull();
    });

    it('should not be searchable after removal', async () => {
      await provider.add(
        createTestSkill({
          id: 'remove-search',
          name: 'Unique Search Term Removal',
          description: 'Unique description for removal test',
        }),
      );

      await provider.remove('remove-search');

      const results = await provider.search('Unique Search Term Removal');
      expect(results.find((r) => r.metadata.id === 'remove-search')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should remove all skills', async () => {
      await provider.addMany([
        createTestSkill({ id: 'skill-1' }),
        createTestSkill({ id: 'skill-2' }),
        createTestSkill({ id: 'skill-3' }),
      ]);

      await provider.clear();

      expect(await provider.count({ includeHidden: true })).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      await provider.add(createTestSkill());

      await provider.dispose();

      // After dispose, the provider should be empty
      expect(await provider.count({ includeHidden: true })).toBe(0);
    });
  });

  describe('setToolValidator', () => {
    it('should set validator after construction', async () => {
      const skill = createTestSkill({
        id: 'validator-test',
        tools: [{ name: 'tool1' }, { name: 'missing-tool' }],
      });
      await provider.add(skill);

      // Before setting validator
      const beforeResult = await provider.load('validator-test');
      expect(beforeResult?.missingTools).toEqual([]);

      // Set validator
      const registry = createMockToolRegistry(['tool1']);
      provider.setToolValidator(new SkillToolValidator(registry));

      // After setting validator
      const afterResult = await provider.load('validator-test');
      expect(afterResult?.missingTools).toEqual(['missing-tool']);
    });
  });
});
