// file: libs/sdk/src/skill/flows/load-skill.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { InvalidInputError, InternalMcpError } from '../../errors';
import { formatSkillForLLM, generateNextSteps } from '../skill.utils';
import { formatSkillForLLMWithSchemas } from '../skill-http.utils';
import type { SkillLoadResult } from '../skill-storage.interface';
import type { SkillSessionManager } from '../session/skill-session.manager';
import type { SkillPolicyMode, SkillActivationResult } from '../session/skill-session.types';
import type { Scope } from '../../scope';

// Input schema matching MCP request format - supports multiple skill IDs
const inputSchema = z.object({
  request: z.object({
    method: z.literal('skills/load'),
    params: z.object({
      skillIds: z.array(z.string().min(1)).min(1).max(5).describe('Array of skill IDs to load (1-5 skills)'),
      format: z
        .enum(['full', 'instructions-only'])
        .default('full')
        .describe('Output format: full (all details) or instructions-only (just the workflow steps)'),
      activateSession: z
        .boolean()
        .default(false)
        .describe('Whether to activate a skill session for tool authorization enforcement'),
      policyMode: z
        .enum(['strict', 'approval', 'permissive'])
        .optional()
        .describe('Tool authorization policy mode (only used when activateSession is true)'),
    }),
  }),
  ctx: z.unknown(),
});

// Single skill result schema
const skillResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      purpose: z.string().optional(),
      available: z.boolean(),
      inputSchema: z.unknown().optional().describe('JSON Schema for tool input'),
      outputSchema: z.unknown().optional().describe('JSON Schema for tool output'),
    }),
  ),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  availableTools: z.array(z.string()),
  missingTools: z.array(z.string()),
  isComplete: z.boolean(),
  warning: z.string().optional(),
  formattedContent: z.string().describe('Formatted skill content ready for LLM consumption (includes tool schemas)'),
  // Session activation info (only present when activateSession is true)
  session: z
    .object({
      activated: z.boolean(),
      sessionId: z.string().optional(),
      policyMode: z.enum(['strict', 'approval', 'permissive']).optional(),
      allowedTools: z.array(z.string()).optional(),
    })
    .optional(),
});

// Output schema with multiple skills and summary
const outputSchema = z.object({
  skills: z.array(skillResultSchema),
  summary: z.object({
    totalSkills: z.number(),
    totalTools: z.number(),
    allToolsAvailable: z.boolean(),
    combinedWarnings: z.array(z.string()).optional(),
  }),
  nextSteps: z.string().describe('Guidance on what to do next with the loaded skills'),
});

type Input = z.infer<typeof inputSchema>;
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

    let params: Input['request']['params'];
    try {
      const inputData = inputSchema.parse(this.rawInput);
      params = inputData.request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    const { skillIds, format, activateSession, policyMode } = params;

    this.state.set({ skillIds, format, activateSession, policyMode, warnings: [] });
    this.logger.verbose('parseInput:done');
  }

  @Stage('loadSkills')
  async loadSkills() {
    this.logger.verbose('loadSkills:start');
    const { skillIds, warnings = [] } = this.state.required;

    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      throw new InternalMcpError('Skill registry not configured');
    }

    const loadResults: LoadResultWithActivation[] = [];

    for (const skillId of skillIds) {
      const result = await skillRegistry.loadSkill(skillId);

      if (!result) {
        warnings.push(`Skill "${skillId}" not found`);
        continue;
      }

      loadResults.push({ loadResult: result });
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
    const { activateSession, policyMode, loadResults } = this.state.required;

    if (!activateSession || !loadResults || loadResults.length === 0) {
      this.logger.verbose('activateSessions:skip (not requested or no skills loaded)');
      return;
    }

    // Try to get skill session manager from scope
    const scope = this.scope as { skillSession?: SkillSessionManager };
    const sessionManager = scope.skillSession;

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
    const { loadResults, warnings = [], format, activateSession } = this.state.required;

    if (!loadResults || loadResults.length === 0) {
      // Return empty result with guidance
      const output: Output = {
        skills: [],
        summary: {
          totalSkills: 0,
          totalTools: 0,
          allToolsAvailable: true,
          combinedWarnings: warnings.length > 0 ? warnings : undefined,
        },
        nextSteps:
          'No skills were loaded. ' +
          (warnings.length > 0 ? warnings.join('; ') : 'Try searchSkills to find available skills.'),
      };
      this.respond(output);
      return;
    }

    const toolRegistry = (this.scope as Scope).tools;
    const skillResults: z.infer<typeof skillResultSchema>[] = [];
    let totalTools = 0;
    let allToolsAvailable = true;

    // Pre-index tool entries for O(1) lookup instead of O(n) per tool
    const toolEntryByName = toolRegistry ? new Map(toolRegistry.getTools(true).map((te) => [te.name, te])) : null;

    for (const { loadResult, activationResult } of loadResults) {
      const { skill, availableTools, missingTools, isComplete, warning } = loadResult;

      if (missingTools.length > 0) {
        allToolsAvailable = false;
      }

      // Build tools array with availability info and schemas
      const tools = skill.tools.map((t) => {
        const isAvailable = availableTools.includes(t.name);
        const result: {
          name: string;
          purpose?: string;
          available: boolean;
          inputSchema?: unknown;
          outputSchema?: unknown;
        } = {
          name: t.name,
          purpose: t.purpose,
          available: isAvailable,
        };

        // Include schemas for available tools
        if (isAvailable && toolEntryByName) {
          const toolEntry = toolEntryByName.get(t.name);
          if (toolEntry) {
            if (toolEntry.rawInputSchema) {
              result.inputSchema = toolEntry.rawInputSchema;
            }
            const rawOutput = toolEntry.getRawOutputSchema?.() ?? toolEntry.rawOutputSchema;
            if (rawOutput) {
              result.outputSchema = rawOutput;
            }
          }
        }

        return result;
      });

      totalTools += tools.length;

      // Format content for LLM
      let formattedContent: string;
      if (format === 'instructions-only') {
        formattedContent = skill.instructions;
      } else if (toolRegistry) {
        formattedContent = formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry);
      } else {
        formattedContent = formatSkillForLLM(skill, availableTools, missingTools);
      }

      const skillResult: z.infer<typeof skillResultSchema> = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        tools,
        parameters: skill.parameters?.map((p) => ({
          name: p.name,
          description: p.description,
          required: p.required,
          type: p.type,
        })),
        availableTools,
        missingTools,
        isComplete,
        warning,
        formattedContent,
      };

      // Add session info if activation was requested
      if (activateSession) {
        if (activationResult) {
          skillResult.session = {
            activated: true,
            sessionId: activationResult.session.sessionId,
            policyMode: activationResult.session.policyMode,
            allowedTools: activationResult.availableTools,
          };
        } else {
          skillResult.session = {
            activated: false,
          };
        }
      }

      skillResults.push(skillResult);
    }

    // Collect all warnings
    const allWarnings = [...warnings];
    for (const result of skillResults) {
      if (result.warning) {
        allWarnings.push(result.warning);
      }
    }

    // Generate next steps guidance
    const nextSteps = generateNextSteps(
      skillResults.map((r) => ({
        name: r.name,
        isComplete: r.isComplete,
        tools: r.tools,
      })),
      allToolsAvailable,
    );

    const output: Output = {
      skills: skillResults,
      summary: {
        totalSkills: skillResults.length,
        totalTools,
        allToolsAvailable,
        combinedWarnings: allWarnings.length > 0 ? allWarnings : undefined,
      },
      nextSteps,
    };

    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
