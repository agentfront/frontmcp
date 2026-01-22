/**
 * External Skill Provider Tests
 *
 * Tests for external skill storage provider base class.
 */

import {
  ExternalSkillProviderBase,
  ExternalSkillProviderOptions,
  ExternalSkillSearchOptions,
  ExternalSkillListOptions,
} from '../providers/external-skill.provider';
import { MemorySyncStateStore } from '../sync/memory-sync-state.store';
import type { SkillContent } from '../../common/interfaces';
import type { SkillSearchResult, SkillLoadResult, SkillListResult } from '../skill-storage.interface';
import type { FrontMcpLogger } from '../../common';

// Helper to create test skills
const createTestSkill = (overrides: Partial<SkillContent> = {}): SkillContent => ({
  id: 'test-skill',
  name: 'Test Skill',
  description: 'A test skill for testing',
  instructions: 'Step 1: Do something\nStep 2: Do another thing',
  tools: [{ name: 'tool1' }, { name: 'tool2', purpose: 'Does something' }],
  ...overrides,
});

// Mock logger
const createMockLogger = (): FrontMcpLogger =>
  ({
    child: jest.fn().mockReturnThis(),
    verbose: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as FrontMcpLogger;

/**
 * Concrete implementation of ExternalSkillProviderBase for testing.
 * Stores skills in memory and tracks method calls.
 */
class TestExternalSkillProvider extends ExternalSkillProviderBase {
  private skills = new Map<string, SkillContent>();

  // Track method calls for verification
  public fetchSkillCalls: string[] = [];
  public fetchSkillsCalls: ExternalSkillListOptions[] = [];
  public searchExternalCalls: Array<{ query: string; options?: ExternalSkillSearchOptions }> = [];
  public upsertSkillCalls: SkillContent[] = [];
  public deleteSkillCalls: string[] = [];

  constructor(options: ExternalSkillProviderOptions) {
    super(options);
  }

  // Pre-populate skills for testing
  setSkills(skills: SkillContent[]): void {
    this.skills.clear();
    for (const skill of skills) {
      this.skills.set(skill.id, skill);
    }
  }

  protected async fetchSkill(skillId: string): Promise<SkillContent | null> {
    this.fetchSkillCalls.push(skillId);
    return this.skills.get(skillId) ?? null;
  }

  protected async fetchSkills(options?: ExternalSkillListOptions): Promise<SkillContent[]> {
    this.fetchSkillsCalls.push(options ?? {});
    return Array.from(this.skills.values());
  }

  protected async searchExternal(query: string, options?: ExternalSkillSearchOptions): Promise<SkillSearchResult[]> {
    this.searchExternalCalls.push({ query, options });
    // Simple search implementation for testing
    const results: SkillSearchResult[] = [];
    for (const skill of this.skills.values()) {
      if (
        skill.name.toLowerCase().includes(query.toLowerCase()) ||
        skill.description.toLowerCase().includes(query.toLowerCase())
      ) {
        results.push({
          metadata: {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            tools: skill.tools.map((t) => t.name),
          },
          score: 0.9,
          availableTools: skill.tools.map((t) => t.name),
          missingTools: [],
          source: 'external',
        });
      }
    }
    return results;
  }

  protected async upsertSkill(skill: SkillContent): Promise<void> {
    this.upsertSkillCalls.push(skill);
    this.skills.set(skill.id, skill);
  }

  protected async deleteSkill(skillId: string): Promise<void> {
    this.deleteSkillCalls.push(skillId);
    this.skills.delete(skillId);
  }

  protected async countExternal(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number> {
    return this.skills.size;
  }

  protected async existsExternal(skillId: string): Promise<boolean> {
    return this.skills.has(skillId);
  }

  // Expose internal state for testing
  getStoredSkills(): Map<string, SkillContent> {
    return new Map(this.skills);
  }

  resetCallTracking(): void {
    this.fetchSkillCalls = [];
    this.fetchSkillsCalls = [];
    this.searchExternalCalls = [];
    this.upsertSkillCalls = [];
    this.deleteSkillCalls = [];
  }
}

describe('ExternalSkillProviderBase', () => {
  describe('read-only mode', () => {
    let provider: TestExternalSkillProvider;

    beforeEach(async () => {
      provider = new TestExternalSkillProvider({
        mode: 'read-only',
        logger: createMockLogger(),
      });
      await provider.initialize();
    });

    afterEach(async () => {
      await provider.dispose();
    });

    it('should report correct mode', () => {
      expect(provider.isReadOnly()).toBe(true);
      expect(provider.isPersistent()).toBe(false);
    });

    it('should have type "external"', () => {
      expect(provider.type).toBe('external');
    });

    describe('search', () => {
      it('should delegate to searchExternal', async () => {
        provider.setSkills([
          createTestSkill({ id: 'skill-1', name: 'Review PR' }),
          createTestSkill({ id: 'skill-2', name: 'Deploy App' }),
        ]);

        const results = await provider.search('review');

        expect(provider.searchExternalCalls.length).toBe(1);
        expect(provider.searchExternalCalls[0].query).toBe('review');
        expect(results.length).toBe(1);
        expect(results[0].metadata.name).toBe('Review PR');
      });

      it('should pass options to searchExternal', async () => {
        await provider.search('test', { topK: 5, minScore: 0.5 });

        expect(provider.searchExternalCalls[0].options?.topK).toBe(5);
        expect(provider.searchExternalCalls[0].options?.minScore).toBe(0.5);
      });
    });

    describe('load', () => {
      it('should load skill by ID', async () => {
        provider.setSkills([createTestSkill({ id: 'skill-1' })]);

        const result = await provider.load('skill-1');

        expect(result).not.toBeNull();
        expect(result?.skill.id).toBe('skill-1');
        expect(result?.isComplete).toBe(true);
      });

      it('should return null for non-existent skill', async () => {
        const result = await provider.load('non-existent');

        expect(result).toBeNull();
      });

      it('should include tool names in result', async () => {
        provider.setSkills([
          createTestSkill({
            id: 'skill-1',
            tools: [{ name: 'tool1' }, { name: 'tool2' }],
          }),
        ]);

        const result = await provider.load('skill-1');

        expect(result?.availableTools).toEqual(['tool1', 'tool2']);
        expect(result?.missingTools).toEqual([]);
      });
    });

    describe('list', () => {
      it('should list all skills', async () => {
        provider.setSkills([createTestSkill({ id: 'skill-1' }), createTestSkill({ id: 'skill-2' })]);

        const result = await provider.list();

        expect(result.skills.length).toBe(2);
        expect(result.total).toBe(2);
      });
    });

    describe('exists', () => {
      it('should return true for existing skill', async () => {
        provider.setSkills([createTestSkill({ id: 'skill-1' })]);

        const exists = await provider.exists('skill-1');

        expect(exists).toBe(true);
      });

      it('should return false for non-existent skill', async () => {
        const exists = await provider.exists('non-existent');

        expect(exists).toBe(false);
      });
    });

    describe('syncSkills', () => {
      it('should throw error in read-only mode', async () => {
        await expect(provider.syncSkills([])).rejects.toThrow('only available in persistent mode');
      });
    });
  });

  describe('persistent mode', () => {
    let provider: TestExternalSkillProvider;
    let syncStateStore: MemorySyncStateStore;

    beforeEach(async () => {
      syncStateStore = new MemorySyncStateStore();
      provider = new TestExternalSkillProvider({
        mode: 'persistent',
        syncStateStore,
        logger: createMockLogger(),
      });
      await provider.initialize();
    });

    afterEach(async () => {
      await provider.dispose();
    });

    it('should report correct mode', () => {
      expect(provider.isReadOnly()).toBe(false);
      expect(provider.isPersistent()).toBe(true);
    });

    describe('syncSkills', () => {
      it('should add new skills', async () => {
        const skills = [createTestSkill({ id: 'skill-1' }), createTestSkill({ id: 'skill-2' })];

        const result = await provider.syncSkills(skills);

        expect(result.added).toEqual(['skill-1', 'skill-2']);
        expect(result.updated).toEqual([]);
        expect(result.unchanged).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(provider.upsertSkillCalls.length).toBe(2);
      });

      it('should update changed skills', async () => {
        const originalSkill = createTestSkill({ id: 'skill-1', description: 'Original' });

        // First sync - add skill
        await provider.syncSkills([originalSkill]);
        provider.resetCallTracking();

        // Second sync - update skill
        const updatedSkill = createTestSkill({ id: 'skill-1', description: 'Updated' });
        const result = await provider.syncSkills([updatedSkill]);

        expect(result.added).toEqual([]);
        expect(result.updated).toEqual(['skill-1']);
        expect(result.unchanged).toEqual([]);
        expect(provider.upsertSkillCalls.length).toBe(1);
      });

      it('should not update unchanged skills', async () => {
        const skill = createTestSkill({ id: 'skill-1' });

        // First sync
        await provider.syncSkills([skill]);
        provider.resetCallTracking();

        // Second sync with same content
        const result = await provider.syncSkills([skill]);

        expect(result.added).toEqual([]);
        expect(result.updated).toEqual([]);
        expect(result.unchanged).toEqual(['skill-1']);
        expect(provider.upsertSkillCalls.length).toBe(0);
      });

      it('should remove deleted skills', async () => {
        // First sync with two skills
        await provider.syncSkills([createTestSkill({ id: 'skill-1' }), createTestSkill({ id: 'skill-2' })]);
        provider.resetCallTracking();

        // Second sync with only one skill
        const result = await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);

        expect(result.removed).toEqual(['skill-2']);
        expect(provider.deleteSkillCalls).toEqual(['skill-2']);
      });

      it('should persist sync state', async () => {
        await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);

        const state = await syncStateStore.load();

        expect(state).not.toBeNull();
        expect(state?.entries.size).toBe(1);
        expect(state?.entries.get('skill-1')?.status).toBe('synced');
      });

      it('should return duration in result', async () => {
        const result = await provider.syncSkills([createTestSkill()]);

        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });

      it('should handle mixed operations', async () => {
        // Initial sync with 3 skills
        await provider.syncSkills([
          createTestSkill({ id: 'skill-1', description: 'Original 1' }),
          createTestSkill({ id: 'skill-2', description: 'Original 2' }),
          createTestSkill({ id: 'skill-3', description: 'Original 3' }),
        ]);
        provider.resetCallTracking();

        // Second sync: update skill-1, keep skill-2, remove skill-3, add skill-4
        const result = await provider.syncSkills([
          createTestSkill({ id: 'skill-1', description: 'Updated 1' }),
          createTestSkill({ id: 'skill-2', description: 'Original 2' }),
          createTestSkill({ id: 'skill-4', description: 'New 4' }),
        ]);

        expect(result.added).toEqual(['skill-4']);
        expect(result.updated).toEqual(['skill-1']);
        expect(result.unchanged).toEqual(['skill-2']);
        expect(result.removed).toEqual(['skill-3']);
      });
    });

    describe('getSyncState', () => {
      it('should return null before first sync', () => {
        const state = provider.getSyncState();

        expect(state).toBeNull();
      });

      it('should return state after sync', async () => {
        await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);

        const state = provider.getSyncState();

        expect(state).not.toBeNull();
        expect(state?.entries.size).toBe(1);
      });

      it('should return deep copy', async () => {
        await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);

        const state1 = provider.getSyncState();
        state1?.entries.set('skill-2', {
          skillId: 'skill-2',
          hash: 'abc',
          lastSyncedAt: Date.now(),
          status: 'synced',
        });
        const state2 = provider.getSyncState();

        expect(state1?.entries.size).toBe(2);
        expect(state2?.entries.size).toBe(1);
      });
    });

    describe('clearSyncState', () => {
      it('should clear sync state', async () => {
        await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);
        await provider.clearSyncState();

        const state = provider.getSyncState();
        const storeState = await syncStateStore.load();

        expect(state).toBeNull();
        expect(storeState).toBeNull();
      });

      it('should force full re-sync on next syncSkills', async () => {
        await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);
        await provider.clearSyncState();
        provider.resetCallTracking();

        // After clearing, the same skill should be added again
        const result = await provider.syncSkills([createTestSkill({ id: 'skill-1' })]);

        expect(result.added).toEqual(['skill-1']);
        expect(result.unchanged).toEqual([]);
      });
    });
  });

  describe('initialization', () => {
    it('should load existing sync state on init', async () => {
      const syncStateStore = new MemorySyncStateStore();

      // Pre-populate sync state
      await syncStateStore.save({
        version: 1,
        lastFullSync: Date.now(),
        entries: new Map([
          [
            'skill-1',
            {
              skillId: 'skill-1',
              hash: 'existing-hash',
              lastSyncedAt: Date.now(),
              status: 'synced' as const,
            },
          ],
        ]),
      });

      const provider = new TestExternalSkillProvider({
        mode: 'persistent',
        syncStateStore,
        logger: createMockLogger(),
      });
      await provider.initialize();

      // Provider should have loaded the existing state
      const state = provider.getSyncState();
      expect(state?.entries.size).toBe(1);
      expect(state?.entries.get('skill-1')?.hash).toBe('existing-hash');
    });

    it('should handle missing sync state store in persistent mode', async () => {
      const logger = createMockLogger();
      const provider = new TestExternalSkillProvider({
        mode: 'persistent',
        logger, // No syncStateStore
      });

      await provider.initialize();

      // Should log a warning
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('options', () => {
    it('should use default topK and minScore', async () => {
      const provider = new TestExternalSkillProvider({
        mode: 'read-only',
      });
      await provider.initialize();

      await provider.search('test');

      expect(provider.searchExternalCalls[0].options?.topK).toBe(10);
      expect(provider.searchExternalCalls[0].options?.minScore).toBe(0.1);
    });

    it('should use custom topK and minScore', async () => {
      const provider = new TestExternalSkillProvider({
        mode: 'read-only',
        defaultTopK: 25,
        defaultMinScore: 0.3,
      });
      await provider.initialize();

      await provider.search('test');

      expect(provider.searchExternalCalls[0].options?.topK).toBe(25);
      expect(provider.searchExternalCalls[0].options?.minScore).toBe(0.3);
    });
  });
});
