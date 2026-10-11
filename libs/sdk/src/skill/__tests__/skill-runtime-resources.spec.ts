/**
 * SEP-2640: `resources/list` names `skill://<skill-path>/SKILL.md` for every skill the server serves,
 * including a skill registered after startup, and stops naming one that is removed.
 */
import 'reflect-metadata';

import { App, DynamicPlugin, LogLevel, Plugin, ScopeEntry, skill, Tool, ToolContext } from '../../common';
import { connect, type DirectClient } from '../../direct';

@Tool({ name: 'add_late_skill', inputSchema: {} })
class AddLateSkillTool extends ToolContext {
  async execute() {
    await this.get(ScopeEntry).skills.registerSkillContent({
      id: 'late-skill',
      name: 'late-skill',
      description: 'A skill registered after startup',
      instructions: 'Do the late thing.',
      tools: [],
    });
    return { added: true };
  }
}

@Tool({ name: 'remove_late_skill', inputSchema: {} })
class RemoveLateSkillTool extends ToolContext {
  async execute() {
    return { removed: await this.get(ScopeEntry).skills.unregisterSkill('late-skill') };
  }
}

@Plugin({ name: 'late-skills', dynamicSkills: true, tools: [AddLateSkillTool, RemoveLateSkillTool] })
class LateSkillsPlugin extends DynamicPlugin<Record<string, never>> {}

const startupSkill = skill({ name: 'startup-skill', description: 'Present at startup', instructions: 'Do it.' });

@App({ id: 'desk', name: 'Desk', skills: [startupSkill] })
class DeskApp {}

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

async function skillUris(client: DirectClient): Promise<string[]> {
  const { resources } = await client.listResources();
  return resources.map((resource) => resource.uri).filter((uri) => uri.startsWith('skill://'));
}

describe('skill:// resources of skills registered at runtime', () => {
  const clients: DirectClient[] = [];
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
  });

  async function connectTo(apps: Array<typeof DeskApp>): Promise<DirectClient> {
    const client = await connect({
      info: { name: 'runtime-skill-resources', version: '1.0.0' },
      apps,
      plugins: [LateSkillsPlugin],
      logging: { level: LogLevel.Off },
    });
    clients.push(client);
    return client;
  }

  it('lists a skill added after startup next to the startup skills', async () => {
    const client = await connectTo([DeskApp]);
    expect(await skillUris(client)).toContain('skill://startup-skill/SKILL.md');

    await client.callTool('add_late_skill', {});

    expect(await skillUris(client)).toEqual(
      expect.arrayContaining(['skill://startup-skill/SKILL.md', 'skill://late-skill/SKILL.md']),
    );
  });

  it('lists a skill added after startup on a server that started with none', async () => {
    const client = await connectTo([EmptyApp]);

    await client.callTool('add_late_skill', {});

    expect(await skillUris(client)).toContain('skill://late-skill/SKILL.md');
  });

  it('reads the SKILL.md of a skill added after startup', async () => {
    const client = await connectTo([DeskApp]);

    await client.callTool('add_late_skill', {});

    expect(JSON.stringify(await client.readResource('skill://late-skill/SKILL.md'))).toContain('Do the late thing.');
  });

  it('stops listing a skill once it is removed', async () => {
    const client = await connectTo([DeskApp]);
    await client.callTool('add_late_skill', {});

    await client.callTool('remove_late_skill', {});

    expect(await skillUris(client)).not.toContain('skill://late-skill/SKILL.md');
  });
});
