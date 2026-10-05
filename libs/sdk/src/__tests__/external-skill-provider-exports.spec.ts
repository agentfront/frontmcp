/**
 * A skill provider backed by external storage can be written and installed with what `@frontmcp/sdk`
 * exports: `ExternalSkillProviderBase`, the types its constructor and abstract methods take, and
 * `SkillRegistry.setExternalProvider()`.
 */
import 'reflect-metadata';

import {
  App,
  ExternalSkillProviderBase,
  FrontMcpInstance,
  LogLevel,
  SkillRegistry,
  Tool,
  ToolContext,
  type ExternalSkillListOptions,
  type ExternalSkillProviderOptions,
  type ExternalSkillSearchOptions,
  type SkillContent,
  type SkillSearchResult,
  type SkillSyncState,
  type SkillSyncStateStore,
} from '../index';

const sharedSkill: SkillContent = {
  id: 'release-checklist',
  name: 'release-checklist',
  description: 'Steps to cut a release',
  instructions: 'Tag, build, publish.',
  tools: [],
};

class InMemorySyncStateStore implements SkillSyncStateStore {
  private state: SkillSyncState | null = null;

  async load(): Promise<SkillSyncState | null> {
    return this.state;
  }

  async save(state: SkillSyncState): Promise<void> {
    this.state = state;
  }

  async clear(): Promise<void> {
    this.state = null;
  }
}

class SharedSkillProvider extends ExternalSkillProviderBase {
  private readonly skills = new Map<string, SkillContent>([[sharedSkill.id, sharedSkill]]);

  constructor(options: ExternalSkillProviderOptions) {
    super(options);
  }

  protected async fetchSkill(skillId: string): Promise<SkillContent | null> {
    return this.skills.get(skillId) ?? null;
  }

  protected async fetchSkills(_options?: ExternalSkillListOptions): Promise<SkillContent[]> {
    return [...this.skills.values()];
  }

  protected async searchExternal(_query: string, _options?: ExternalSkillSearchOptions): Promise<SkillSearchResult[]> {
    return [];
  }

  protected async upsertSkill(skill: SkillContent): Promise<void> {
    this.skills.set(skill.id, skill);
  }

  protected async deleteSkill(skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  protected async countExternal(): Promise<number> {
    return this.skills.size;
  }

  protected async existsExternal(skillId: string): Promise<boolean> {
    return this.skills.has(skillId);
  }
}

const sharedSkills = new SharedSkillProvider({ mode: 'read-only', syncStateStore: new InMemorySyncStateStore() });

@Tool({ name: 'use_shared_skills', inputSchema: {} })
class UseSharedSkillsTool extends ToolContext {
  async execute() {
    const registry = this.scope.skills;
    if (!(registry instanceof SkillRegistry)) return { installed: false };
    registry.setExternalProvider(sharedSkills);
    return { installed: registry.getExternalProvider() === sharedSkills };
  }
}

@App({ id: 'skills-host', name: 'Skills Host', tools: [UseSharedSkillsTool] })
class SkillsHostApp {}

describe('external skill providers from the public API', () => {
  it('extend ExternalSkillProviderBase', async () => {
    const loaded = await sharedSkills.load('release-checklist');

    expect(sharedSkills.isReadOnly()).toBe(true);
    expect(loaded?.skill.name).toBe('release-checklist');
  });

  it('install with SkillRegistry.setExternalProvider()', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'external-skills', version: '1.0.0' },
      apps: [SkillsHostApp],
      logging: { level: LogLevel.Off },
    });

    try {
      const result = await server.callTool('use_shared_skills', {});
      expect(result.structuredContent).toEqual({ installed: true });
    } finally {
      await server.dispose();
    }
  });
});
