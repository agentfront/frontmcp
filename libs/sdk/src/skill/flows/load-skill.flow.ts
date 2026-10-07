// file: libs/sdk/src/skill/flows/load-skill.flow.ts

import { z } from '@frontmcp/lazy-zod';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { InvalidInputError, PublicMcpError } from '../../errors';
import { SkillsLoadRequestSchema, SkillsLoadResultSchema } from '../../transport/mcp-handlers/skills-mcp.types';
import type { SkillActivationResult, SkillPolicyMode } from '../session/skill-session.types';
import { assertSkillAuthorized } from '../skill-authorities.helper';
import { createSkillEntryResolver } from '../skill-entry.resolver';
import { isSkillServable, skillToolsForCaller } from '../skill-filter.helper';
import { formatSkillForLLMWithSchemas } from '../skill-http.utils';
import type { SkillLoadResult } from '../skill-storage.interface';
import { formatSkillForLLM } from '../skill.utils';

const inputSchema = z.object({
  request: SkillsLoadRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = SkillsLoadResultSchema;

type Output = z.infer<typeof outputSchema>;

// Load result with activation info for state
interface LoadResultWithActivation {
  loadResult: SkillLoadResult;
  activationResult?: SkillActivationResult;
}

const stateSchema = z.object({
  skillIds: z.array(z.string()),
  format: z.enum(['full', 'instructions-only']),
  activateSession: z.boolean(),
  policyMode: z.enum(['strict', 'approval', 'permissive']).optional(),
  loadResults: z.unknown().optional() as z.ZodType<LoadResultWithActivation[] | undefined>,
  warnings: z.array(z.string()).optional(),
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput'],
  execute: ['loadSkills', 'activateSessions'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'skills:load': FlowRunOptions<
      LoadSkillFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills:load' as const;
const { Stage } = FlowHooksOf<'skills:load'>(name);

/**
 * Flow for loading one or more skills' full content.
 *
 * This flow retrieves skill instructions, tool requirements, and parameters.
 * Use this after searching for skills to get the detailed workflow guides.
 *
 * @example MCP Request
 * ```json
 * {
 *   "method": "skills/load",
 *   "params": {
 *     "skillIds": ["review-pr", "suggest-fixes"],
 *     "format": "full"
 *   }
 * }
 * ```
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class LoadSkillFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('LoadSkillFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let params: z.infer<typeof SkillsLoadRequestSchema>['params'];
    try {
      params = inputSchema.parse(this.rawInput).request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    const { skillIds, format = 'full', activateSession = false, policyMode } = params;

    this.state.set({ skillIds, format, activateSession, policyMode, warnings: [] });
    this.logger.verbose('parseInput:done');
  }

  @Stage('loadSkills')
  async loadSkills() {
    this.logger.verbose('loadSkills:start');
    const { skillIds, warnings = [] } = this.state.required;

    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
    }

    // AuthInfo for entry-level authorities checks (RBAC/ABAC/ReBAC). MCP flows
    // carry it under rawInput.ctx — same source the resource list flow uses.
    const ctx = (this.rawInput as Record<string, unknown>)['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const loadResults: LoadResultWithActivation[] = [];
    const resolveEntry = createSkillEntryResolver(skillRegistry);

    for (const skillId of skillIds) {
      const result = await skillRegistry.loadSkill(skillId);

      if (!result) {
        warnings.push(`Skill "${skillId}" not found`);
        continue;
      }

      // Deny direct load of an authority-gated skill the caller can't access
      // (throws AuthorityDeniedError, MCP code -32003 — same as a denied tool).
      // No-op when the skill has no `authorities` or no engine is configured.
      const entry = resolveEntry(skillId, result.skill.id);
      if (entry) {
        if (!(await isSkillServable(this.scope, entry, ctx))) {
          warnings.push(`Skill "${skillId}" not found`);
          continue;
        }
        await assertSkillAuthorized(this.scope, entry, authInfo);
      }

      // Only the tools the caller can reach count as available (and have schemas): an agent-only
      // tool is missing to an MCP client, as `tools/list` and `tools/call` treat it.
      const loadResult = skillToolsForCaller(result, this.scope.tools, ctx);
      if (loadResult.warning) warnings.push(loadResult.warning);
      loadResults.push({ loadResult });
    }

    this.state.set({ loadResults, warnings });
    this.logger.verbose('loadSkills:done', { loaded: loadResults.length, notFound: warnings.length });
  }

  /**
   * Activate skill sessions for tool authorization enforcement.
   * This stage only runs if activateSession is true in the input.
   */
  @Stage('activateSessions')
  async activateSessions() {
    this.logger.verbose('activateSessions:start');
    const { activateSession, loadResults } = this.state.required;
    const { policyMode } = this.state;

    if (!activateSession || !loadResults || loadResults.length === 0) {
      this.logger.verbose('activateSessions:skip (not requested or no skills loaded)');
      return;
    }

    const sessionManager = this.scope.skillSession;

    if (!sessionManager) {
      this.logger.verbose('activateSessions:skip (no session manager available)');
      return;
    }

    // Check if we're in a session context
    const existingSession = sessionManager.getActiveSession();
    if (!existingSession) {
      this.logger.warn('activateSessions: not in a session context, cannot activate skill sessions');
      return;
    }

    // Override policy mode if specified (session-level setting, apply before activating skills)
    if (policyMode) {
      sessionManager.setPolicyMode(policyMode as SkillPolicyMode);
    }

    // Activate each skill
    for (const item of loadResults) {
      const { skill } = item.loadResult;
      const activationResult = sessionManager.activateSkill(skill.id, skill, item.loadResult);

      item.activationResult = activationResult;
      this.logger.info(`activateSessions: activated skill "${skill.id}"`, {
        policyMode: activationResult.session.policyMode,
        allowedTools: activationResult.availableTools,
      });
    }

    this.state.set({ loadResults });
    this.logger.verbose('activateSessions:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { loadResults = [], warnings = [], format, activateSession } = this.state.required;

    const toolRegistry = this.scope.tools;
    const withSchemas = format !== 'instructions-only';
    const toolsByName = new Map(
      withSchemas && toolRegistry ? toolRegistry.getTools(false).map((t) => [t.name, t]) : [],
    );
    const allToolNames = new Set<string>();
    let allToolsAvailable = true;

    const skills: Output['skills'] = loadResults.map(({ loadResult, activationResult }) => {
      const { skill, availableTools, missingTools, isComplete } = loadResult;
      if (!isComplete) allToolsAvailable = false;
      for (const tool of skill.tools) allToolNames.add(tool.name);

      const tools = skill.tools.map(({ name, purpose }) => {
        const available = availableTools.includes(name);
        const toolEntry = withSchemas && available ? toolsByName.get(name) : undefined;
        return { name, purpose, available, ...(toolEntry && { inputSchema: toolEntry.getInputJsonSchema() }) };
      });
      const session = activationResult
        ? {
            activated: true,
            sessionId: activationResult.session.sessionId,
            policyMode: activationResult.session.policyMode,
            allowedTools: activationResult.availableTools,
          }
        : { activated: false };

      return {
        id: skill.id,
        name: skill.name,
        description: skill.description ?? '',
        instructions: skill.instructions,
        tools,
        parameters: skill.parameters?.map(({ name, description, required, type }) => ({
          name,
          description,
          required,
          type,
        })),
        availableTools,
        missingTools,
        isComplete,
        formattedContent: toolRegistry
          ? formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry)
          : formatSkillForLLM(skill, availableTools, missingTools),
        session: activateSession ? session : undefined,
      };
    });

    this.respond({
      skills,
      summary: {
        totalSkills: skills.length,
        totalTools: allToolNames.size,
        allToolsAvailable,
        combinedWarnings: warnings.length > 0 ? warnings : undefined,
      },
      nextSteps:
        skills.length > 0
          ? `Loaded ${skills.length} skill(s). Follow the instructions to complete the task.`
          : 'No skills were loaded. Check the skill IDs and try again.',
    });
    this.logger.verbose('finalize:done');
  }
}
