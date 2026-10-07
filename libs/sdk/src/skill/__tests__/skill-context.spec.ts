import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Skill, SkillContext, type SkillContent } from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';

@Skill({ name: 'release-notes', description: 'Write release notes', instructions: 'Static steps.' })
class ReleaseNotesSkill extends SkillContext {
  override async loadInstructions(): Promise<string> {
    return `Steps for ${this.skillName}, written by loadInstructions().`;
  }
}

@Skill({ name: 'triage', description: 'Triage tickets', instructions: 'Sort tickets by severity.' })
class TriageSkill extends SkillContext {
  override async build(): Promise<SkillContent> {
    const content = await super.build();
    return {
      ...content,
      description: 'Triage tickets by severity',
      instructions: `${content.instructions}\n\nAdded by build().`,
    };
  }
}

@Skill({ name: 'plain', description: 'Plain skill', instructions: 'Plain steps.' })
class PlainSkill extends SkillContext {}

@App({ id: 'desk', name: 'Desk', skills: [ReleaseNotesSkill, TriageSkill, PlainSkill] })
class DeskApp {}

describe('SkillContext overrides', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'skill-context', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  async function instructionsOf(skillId: string): Promise<string | undefined> {
    const { skills } = await client.loadSkills([skillId]);
    return skills[0]?.instructions;
  }

  it('serves the instructions an overridden loadInstructions() returns', async () => {
    await expect(instructionsOf('release-notes')).resolves.toBe(
      'Steps for release-notes, written by loadInstructions().',
    );
  });

  it('serves the content an overridden build() returns, built on super.build()', async () => {
    await expect(instructionsOf('triage')).resolves.toBe('Sort tickets by severity.\n\nAdded by build().');
  });

  it('serves the decorator instructions when nothing is overridden', async () => {
    await expect(instructionsOf('plain')).resolves.toBe('Plain steps.');
  });

  it('lists the description an overridden build() returns in skill://index.json, as SKILL.md has it', async () => {
    const index = await client.readResource('skill://index.json');
    const document = JSON.parse((index.contents[0] as { text: string }).text) as {
      skills: Array<{ name?: string; description: string }>;
    };
    const skillMd = await client.readResource('skill://triage/SKILL.md');

    expect(document.skills.find((entry) => entry.name === 'triage')?.description).toBe('Triage tickets by severity');
    expect((skillMd.contents[0] as { text: string }).text).toContain('description: Triage tickets by severity');
  });

  it('describes the SKILL.md resource with that description in resources/list', async () => {
    const { resources } = await client.listResources();

    expect(resources.find((resource) => resource.uri === 'skill://triage/SKILL.md')?.description).toBe(
      'Triage tickets by severity',
    );
  });
});

describe('the description an overridden build() returns, wherever skills are listed', () => {
  const builtDescription = 'Triage tickets by severity';
  let client: DirectClient;
  let server: TestFetchServer;

  beforeAll(async () => {
    const config = {
      info: { name: 'skill-context-listings', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      skillsConfig: { enabled: true, sep2640InInstructions: true },
    };
    client = await connect(config);
    server = await createTestFetchServer(config);
  });

  afterAll(async () => {
    await client.close();
  });

  async function get(path: string): Promise<string> {
    return (await server.handler(new Request(new URL(path, 'http://localhost')))).text();
  }

  it('in skills/search and skills/list', async () => {
    const found = await client.searchSkills('triage tickets');
    const listed = await client.listSkills();

    expect(found.skills.find((skill) => skill.name === 'triage')?.description).toBe(builtDescription);
    expect(listed.skills.find((skill) => skill.name === 'triage')?.description).toBe(builtDescription);
  });

  it('in the skill catalog and skill:// hints of the instructions', async () => {
    const { message } = await rpc20260728(server.handler, 'server/discover');
    const instructions = String(message.result?.['instructions']);

    expect(instructions).toContain(`- **triage**: ${builtDescription}`);
    expect(instructions).toContain(`- skill://triage/SKILL.md — ${builtDescription}`);
  });

  it('in /llm.txt and the /skills HTTP listing', async () => {
    const listing = JSON.parse(await get('/skills')) as { skills: Array<{ name: string; description: string }> };

    expect(await get('/llm.txt')).toContain(`# triage\n${builtDescription}`);
    expect(listing.skills.find((skill) => skill.name === 'triage')?.description).toBe(builtDescription);
  });
});

const overrideCalls = { loadInstructions: 0, build: 0 };
let failNextLoad = false;

@Skill({ name: 'counted', description: 'Counts override runs', instructions: 'Counted steps.' })
class CountedSkill extends SkillContext {
  override async loadInstructions(): Promise<string> {
    overrideCalls.loadInstructions++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (failNextLoad) {
      failNextLoad = false;
      throw new Error('instructions source unavailable');
    }
    return 'Counted steps.';
  }

  override async build(): Promise<SkillContent> {
    overrideCalls.build++;
    return super.build();
  }
}

@App({ id: 'counter', name: 'Counter', skills: [CountedSkill] })
class CounterApp {}

describe('SkillContext overrides under concurrent loads', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'skill-context-concurrency', version: '1.0.0' },
      apps: [CounterApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  function countedSkill() {
    const skill = (server as unknown as { scope: Scope }).scope.skills.findByName('counted');
    if (!skill || !('clearCache' in skill)) throw new Error('counted is not registered');
    (skill as { clearCache(): void }).clearCache();
    overrideCalls.loadInstructions = 0;
    overrideCalls.build = 0;
    return skill;
  }

  it('runs each override once for loads that start before the first finishes', async () => {
    const skill = countedSkill();

    await Promise.all([skill.load(), skill.load(), skill.loadInstructions()]);

    expect(overrideCalls).toEqual({ loadInstructions: 1, build: 1 });
  });

  it('runs the override again after a load fails', async () => {
    const skill = countedSkill();
    failNextLoad = true;

    await expect(skill.loadInstructions()).rejects.toThrow('instructions source unavailable');
    await expect(skill.loadInstructions()).resolves.toBe('Counted steps.');
    expect(overrideCalls.loadInstructions).toBe(2);
  });
});
