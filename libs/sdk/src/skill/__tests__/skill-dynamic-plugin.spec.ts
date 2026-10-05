/**
 * `@Plugin({ dynamicSkills: true })`: a plugin that registers skills at runtime gets the skills
 * capability and methods from startup, before its first skill exists.
 *
 * The scope decides while starting whether it serves skills. A server whose only skills a plugin
 * registers later (a skill bundle it loads) answered `skills/list` with `-32601` for every session
 * opened before then, declared no SEP-2640 capability, and never served `skill://index.json`.
 */
import 'reflect-metadata';

import { App, DynamicPlugin, LogLevel, Plugin, ScopeEntry, Tool, ToolContext } from '../../common';
import { connect, type DirectClient } from '../../direct';

const SEP_2640_EXTENSION_ID = 'io.modelcontextprotocol/skills';

/** Registers a skill when its `add_late_skill` tool runs, as a bundle loader would once loaded. */
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

@Plugin({ name: 'late-skills', dynamicSkills: true, tools: [AddLateSkillTool] })
class LateSkillsPlugin extends DynamicPlugin<Record<string, never>> {}

@Plugin({ name: 'late-skills-host', plugins: [LateSkillsPlugin] })
class LateSkillsHostPlugin {}

@App({ id: 'desk', name: 'Desk', plugins: [LateSkillsPlugin] })
class DeskApp {}

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

/** Reports whether the scope wired the skill session manager, which `activateSession` and the skill tool guard need. */
@Tool({ name: 'skill_session_wired', inputSchema: {} })
class SkillSessionWiredTool extends ToolContext {
  async execute() {
    return { wired: this.get(ScopeEntry).skillSession !== undefined };
  }
}

@App({ id: 'probe', name: 'Probe', tools: [SkillSessionWiredTool] })
class ProbeApp {}

async function skillSessionWired(client: DirectClient): Promise<unknown> {
  const result = (await client.callTool('skill_session_wired', {})) as { structuredContent?: { wired?: unknown } };
  return result.structuredContent?.wired;
}

function skillsErrorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'answered',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe('@Plugin({ dynamicSkills: true })', () => {
  const clients: DirectClient[] = [];
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
  });

  async function connectTo(config: Parameters<typeof connect>[0]): Promise<DirectClient> {
    const client = await connect({ logging: { level: LogLevel.Off }, ...config });
    clients.push(client);
    return client;
  }

  it('serves skills/list, the capability and skill://index.json before the first skill exists', async () => {
    const client = await connectTo({
      info: { name: 'late-skills-server', version: '1.0.0' },
      apps: [EmptyApp],
      plugins: [LateSkillsPlugin],
    });

    expect((await client.listSkills()).skills).toEqual([]);
    const capabilities = client.getCapabilities() as { experimental?: Record<string, unknown> };
    expect(capabilities.experimental?.[SEP_2640_EXTENSION_ID]).toBeDefined();
    expect(await skillsErrorOf(client.readResource('skill://index.json'))).toBe('answered');

    await client.callTool('add_late_skill', {});
    expect((await client.listSkills()).skills.map((skill) => skill.id)).toEqual(['late-skill']);
  });

  it('counts a plugin installed by another plugin, or on an app', async () => {
    for (const config of [
      { info: { name: 'nested', version: '1.0.0' }, apps: [EmptyApp], plugins: [LateSkillsHostPlugin] },
      { info: { name: 'on-app', version: '1.0.0' }, apps: [DeskApp] },
    ]) {
      const client = await connectTo(config);
      expect(await skillsErrorOf(client.listSkills())).toBe('answered');
    }
  });

  it('wires the skill session manager and tool guard before the first skill exists', async () => {
    const client = await connectTo({
      info: { name: 'late-skills-session', version: '1.0.0' },
      apps: [ProbeApp],
      plugins: [LateSkillsPlugin],
    });

    expect(await skillSessionWired(client)).toBe(true);
  });

  it('leaves a server with no skills and no such plugin without a skill session manager', async () => {
    const client = await connectTo({ info: { name: 'no-skills-session', version: '1.0.0' }, apps: [ProbeApp] });

    expect(await skillSessionWired(client)).toBe(false);
  });

  it('leaves a server with no skills and no such plugin without the skills methods', async () => {
    const client = await connectTo({ info: { name: 'no-skills', version: '1.0.0' }, apps: [EmptyApp] });

    expect(await skillsErrorOf(client.listSkills())).toMatch(/Method not found/);
  });
});
