// file: plugins/plugin-skilled-openapi/src/tools/load-skill.tool.ts

import { BundleStore } from '@frontmcp/adapters/skills';
import { InternalMcpError, PublicMcpError, ScopeEntry, Tool, ToolContext } from '@frontmcp/sdk';

import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkillVisibility } from '../security/skill-visibility';
import { SkilledOpenApiConfig } from '../skilled-openapi.symbols';
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
    const notFound = () =>
      // Caller-visible: skill id was not registered, or the caller may not see it
      // (the same answer, so a refused skill's existence isn't revealed). Map to a
      // 404 with a stable code so MCP clients can branch on it.
      new PublicMcpError(`Skill "${input.skillId}" not found`, 'SKILL_NOT_FOUND', 404);
    const result = await skillRegistry.loadSkill(input.skillId);
    if (!result) throw notFound();

    // The skill's own rules (bundle `requiredAuthorities`, `@Skill` authorities, the
    // `skills:filter` flow) decide whether the caller may read it at all, and each
    // action's rules whether it is listed.
    const config = this.get(SkilledOpenApiConfig);
    const visibility = new SkillVisibility({
      scope,
      guard: this.get(AuthorityGuard),
      bundle: this.get(BundleStore).current(),
      unprotectedOps: config.unprotectedOps,
      authInfo: this.authInfo,
    });
    const skill = result.skill;
    if (!(await visibility.isVisible(input.skillId)) || !(await visibility.isVisible(skill.id))) throw notFound();
    const actions = skill.actions
      ? await visibility.visibleActions(skill.id, skill.actions, this.get(HiddenOpRegistry))
      : undefined;

    return {
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        ...(skill.bundleVersion !== undefined && { bundleVersion: skill.bundleVersion }),
        ...(actions ? { actions } : {}),
      },
      isComplete: result.isComplete,
      ...(result.warning !== undefined && { warning: result.warning }),
    };
  }
}
