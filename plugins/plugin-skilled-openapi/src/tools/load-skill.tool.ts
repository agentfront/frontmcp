// file: plugins/plugin-skilled-openapi/src/tools/load-skill.tool.ts

import { ScopeEntry, Tool, ToolContext } from '@frontmcp/sdk';

import { BundleSyncService } from '../sync/bundle-sync.service';
import {
  loadSkillDescription,
  loadSkillInputSchema,
  loadSkillOutputSchema,
  type LoadSkillInput,
  type LoadSkillOutput,
} from './load-skill.schema';

@Tool({
  name: 'load_skill',
  description: loadSkillDescription,
  inputSchema: loadSkillInputSchema,
  outputSchema: loadSkillOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
})
export default class LoadSkillTool extends ToolContext {
  async execute(input: LoadSkillInput): Promise<LoadSkillOutput> {
    this.get(BundleSyncService);
    const scope = this.get(ScopeEntry);
    const skillRegistry = scope.skills;
    if (!skillRegistry) {
      throw new Error('SkillRegistry is not available on the active scope');
    }
    const result = await skillRegistry.loadSkill(input.skillId);
    if (!result) {
      throw new Error(`Skill "${input.skillId}" not found`);
    }
    const skill = result.skill;
    return {
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        ...(skill.bundleVersion !== undefined && { bundleVersion: skill.bundleVersion }),
        ...(skill.actions ? { actions: skill.actions } : {}),
      },
      isComplete: result.isComplete,
      ...(result.warning !== undefined && { warning: result.warning }),
    };
  }
}
