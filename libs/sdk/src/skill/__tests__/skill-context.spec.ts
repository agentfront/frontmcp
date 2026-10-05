import 'reflect-metadata';

import { App, LogLevel, Skill, SkillContext, type SkillContent } from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';

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
    return { ...content, instructions: `${content.instructions}\n\nAdded by build().` };
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
});
