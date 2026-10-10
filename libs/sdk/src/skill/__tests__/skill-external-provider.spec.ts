/**
 * An external skill provider set through `skillsConfig.externalProvider` is installed while the scope
 * starts: in `'read-only'` mode the server searches and loads skills through it, even when it declares
 * none itself; in `'persistent'` mode `this.scope.skills.syncToExternal()` copies the local skills to it.
 */
import 'reflect-metadata';

import { App, LogLevel, ScopeEntry, skill, Tool, ToolContext } from '../../common';
import type { SkillContent } from '../../common/interfaces';
import { connect, type DirectClient } from '../../direct';
import { ExternalSkillProviderBase } from '../providers/external-skill.provider';
import type { SkillSearchResult } from '../skill-storage.interface';

const remoteSkill: SkillContent = {
  id: 'remote-skill',
  name: 'remote-skill',
  description: 'Served by the external store',
  instructions: 'Do the remote thing.',
  tools: [],
};

class InMemoryExternalProvider extends ExternalSkillProviderBase {
  readonly upserted: string[] = [];

  protected async fetchSkill(skillId: string): Promise<SkillContent | null> {
    return skillId === remoteSkill.id ? remoteSkill : null;
  }
  protected async fetchSkills(): Promise<SkillContent[]> {
    return [remoteSkill];
  }
  protected async searchExternal(): Promise<SkillSearchResult[]> {
    return [
      {
        metadata: { name: remoteSkill.name, description: remoteSkill.description, instructions: '' },
        score: 0.9,
        availableTools: [],
        missingTools: [],
        source: 'external',
      },
    ];
  }
  protected async upsertSkill(content: SkillContent): Promise<void> {
    this.upserted.push(content.id);
  }
  protected async deleteSkill(): Promise<void> {
    return undefined;
  }
  protected async countExternal(): Promise<number> {
    return 1;
  }
  protected async existsExternal(skillId: string): Promise<boolean> {
    return skillId === remoteSkill.id;
  }
}

@Tool({ name: 'sync_skills', inputSchema: {} })
class SyncSkillsTool extends ToolContext {
  async execute() {
    const result = await this.get(ScopeEntry).skills.syncToExternal();
    return { added: result?.added ?? [] };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [SyncSkillsTool],
  skills: [skill({ name: 'local-skill', description: 'Local', instructions: 'Local.' })],
})
class DeskApp {}

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ id: 'bare', name: 'Bare', tools: [NoopTool] })
class BareApp {}

function connectWith(apps: Array<typeof DeskApp>, externalProvider: unknown): Promise<DirectClient> {
  return connect({
    info: { name: 'external-skills', version: '1.0.0' },
    apps,
    skillsConfig: { externalProvider },
    logging: { level: LogLevel.Off },
  } as Parameters<typeof connect>[0]);
}

describe('skillsConfig.externalProvider', () => {
  let client: DirectClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('loads skills through a read-only external provider', async () => {
    client = await connectWith([DeskApp], new InMemoryExternalProvider({ mode: 'read-only' }));

    const loaded = await client.loadSkills(['remote-skill']);

    expect(loaded.skills.map((entry) => entry.id)).toEqual(['remote-skill']);
  });

  it('searches skills through a read-only external provider', async () => {
    client = await connectWith([DeskApp], new InMemoryExternalProvider({ mode: 'read-only' }));

    const found = await client.searchSkills('remote');

    expect(found.skills.map((entry) => entry.name)).toContain('remote-skill');
  });

  it('serves skills from a read-only external provider on a server that declares none', async () => {
    client = await connectWith([BareApp], new InMemoryExternalProvider({ mode: 'read-only' }));

    const loaded = await client.loadSkills(['remote-skill']);

    expect(loaded.skills.map((entry) => entry.id)).toEqual(['remote-skill']);
  });

  it('copies the local skills to a persistent external provider on syncToExternal()', async () => {
    const provider = new InMemoryExternalProvider({ mode: 'persistent' });
    client = await connectWith([DeskApp], provider);

    await client.callTool('sync_skills', {});

    expect(provider.upserted).toEqual(['local-skill']);
  });

  it('refuses a value that is not an external skill provider', async () => {
    await expect(connectWith([DeskApp], { mode: 'read-only' })).rejects.toThrow(/externalProvider/);
  });
});
