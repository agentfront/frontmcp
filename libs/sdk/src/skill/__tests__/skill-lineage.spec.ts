/**
 * `SkillRegistry.lineageOf`: the owner lineage of a skill as the scope serves it, so a hook's app
 * (`isEntryGatedBy`, `skills:filter`) is found for a skill a plugin contributes, as it is for tools.
 *
 * A plugin-contributed skill is owned by its plugin. The app the plugin is installed on appears only
 * in the skill's registry lineage; without it, every app's plugin hooks judged the skill.
 */
import 'reflect-metadata';

import { App, LogLevel, Plugin, ScopeEntry, Skill, Tool, ToolContext } from '../../common';
import { connect, type DirectClient } from '../../direct';

@Skill({ name: 'refund-playbook', description: 'How to issue a refund', instructions: 'Issue the refund.' })
class RefundPlaybookSkill {}

@Plugin({ name: 'playbooks', skills: [RefundPlaybookSkill] })
class PlaybooksPlugin {}

@Tool({ name: 'skill_lineage', inputSchema: {} })
class SkillLineageTool extends ToolContext {
  async execute() {
    const skills = this.get(ScopeEntry).skills;
    const skill = skills.findByName('refund-playbook');
    const lineage = skill ? (skills.lineageOf?.(skill) ?? []) : [];
    return { lineage: lineage.map((owner) => `${owner.kind}:${owner.id}`) };
  }
}

@App({ id: 'billing', name: 'Billing', plugins: [PlaybooksPlugin], tools: [SkillLineageTool] })
class BillingApp {}

describe('SkillRegistry.lineageOf', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'lineage', version: '1.0.0' },
      apps: [BillingApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('names the app a plugin-contributed skill belongs to', async () => {
    const result = (await client.callTool('skill_lineage', {})) as { structuredContent?: { lineage?: string[] } };

    expect(result.structuredContent?.lineage).toEqual(expect.arrayContaining(['app:billing', 'plugin:playbooks']));
  });
});
