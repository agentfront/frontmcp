// file: plugins/plugin-skilled-openapi/src/tools/load-skill.tool.ts

import { InternalMcpError, PublicMcpError, ScopeEntry, Tool, ToolContext } from '@frontmcp/sdk';

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
    // Await the first bundle apply so the skill registry is populated (stateless
    // workers have no background loop to finish a deferred sync).
    await this.get(BundleSyncService).ensureReady();
    const scope = this.get(ScopeEntry);
    const skillRegistry = scope.skills;
    if (!skillRegistry) {
      // Misconfigured scope — should be impossible at runtime; surface as
      // an internal error so the JSON-RPC envelope carries a 500 / opaque
      // message instead of leaking implementation details.
      throw new InternalMcpError('SkillRegistry is not available on the active scope', 'SKILL_REGISTRY_UNAVAILABLE');
    }
    const result = await skillRegistry.loadSkill(input.skillId);
    if (!result) {
      // Caller-visible: skill id was not registered. Map to a 404 with a
      // stable code so MCP clients can branch on it.
      throw new PublicMcpError(`Skill "${input.skillId}" not found`, 'SKILL_NOT_FOUND', 404);
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
