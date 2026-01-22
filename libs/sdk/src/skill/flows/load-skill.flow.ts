// file: libs/sdk/src/skill/flows/load-skill.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { InvalidInputError } from '../../errors';
import { formatSkillForLLM } from '../skill.utils';
import type { SkillLoadResult } from '../skill-storage.interface';
import type { SkillSessionManager } from '../session/skill-session.manager';
import type { SkillPolicyMode, SkillActivationResult } from '../session/skill-session.types';

// Input schema matching MCP request format
const inputSchema = z.object({
  request: z.object({
    method: z.literal('skills/load'),
    params: z.object({
      skillId: z.string().min(1).describe('ID or name of the skill to load'),
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

// Output schema
const outputSchema = z.object({
  skill: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.array(
      z.object({
        name: z.string(),
        purpose: z.string().optional(),
        available: z.boolean(),
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
  }),
  availableTools: z.array(z.string()),
  missingTools: z.array(z.string()),
  isComplete: z.boolean(),
  warning: z.string().optional(),
  formattedContent: z.string().describe('Formatted skill content ready for LLM consumption'),
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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const stateSchema = z.object({
  skillId: z.string(),
  format: z.enum(['full', 'instructions-only']),
  activateSession: z.boolean(),
  policyMode: z.enum(['strict', 'approval', 'permissive']).optional(),
  loadResult: z.unknown().optional() as z.ZodType<SkillLoadResult | undefined>,
  activationResult: z.unknown().optional() as z.ZodType<SkillActivationResult | undefined>,
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput'],
  execute: ['loadSkill', 'activateSession'],
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
 * Flow for loading a skill's full content.
 *
 * This flow retrieves a skill's instructions, tool requirements, and parameters.
 * Use this after searching for skills to get the detailed workflow guide.
 *
 * @example MCP Request
 * ```json
 * {
 *   "method": "skills/load",
 *   "params": {
 *     "skillId": "review-pr",
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

    const { skillId, format, activateSession, policyMode } = params;
    this.state.set({ skillId, format, activateSession, policyMode });
    this.logger.verbose('parseInput:done');
  }

  @Stage('loadSkill')
  async loadSkill() {
    this.logger.verbose('loadSkill:start');
    const { skillId } = this.state.required;

    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      throw new InvalidInputError('Skills are not available in this scope');
    }

    // Load the skill
    const result = await skillRegistry.loadSkill(skillId);

    if (!result) {
      throw new InvalidInputError(`Skill "${skillId}" not found`);
    }

    // Store load result for session activation
    this.state.set({ loadResult: result });
    this.logger.verbose('loadSkill:done');
  }

  /**
   * Activate a skill session for tool authorization enforcement.
   * This stage only runs if activateSession is true in the input.
   */
  @Stage('activateSession')
  async activateSession() {
    this.logger.verbose('activateSession:start');
    const { activateSession, policyMode, loadResult } = this.state.required;

    if (!activateSession || !loadResult) {
      this.logger.verbose('activateSession:skip (not requested or no skill loaded)');
      return;
    }

    // Try to get skill session manager from scope
    // The manager is optional - it may not be configured
    const scope = this.scope as { skillSession?: SkillSessionManager };
    const sessionManager = scope.skillSession;

    if (!sessionManager) {
      this.logger.verbose('activateSession:skip (no session manager available)');
      return;
    }

    // Check if we're in a session context
    const existingSession = sessionManager.getActiveSession();
    if (!existingSession) {
      this.logger.warn('activateSession: not in a session context, cannot activate skill session');
      return;
    }

    // Activate the skill
    const { skill } = loadResult;
    const activationResult = sessionManager.activateSkill(skill.id, skill, loadResult);

    // Override policy mode if specified
    if (policyMode) {
      sessionManager.setPolicyMode(policyMode as SkillPolicyMode);
    }

    this.state.set({ activationResult });
    this.logger.info(`activateSession: activated skill "${skill.id}"`, {
      policyMode: activationResult.session.policyMode,
      allowedTools: activationResult.availableTools,
    });
    this.logger.verbose('activateSession:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { loadResult, activationResult, format, activateSession } = this.state.required;

    if (!loadResult) {
      throw new InvalidInputError('Skill not loaded');
    }

    const { skill, availableTools, missingTools, isComplete, warning } = loadResult;

    // Build tools array with availability info
    const tools = skill.tools.map((t) => ({
      name: t.name,
      purpose: t.purpose,
      available: availableTools.includes(t.name),
    }));

    // Format content for LLM
    const formattedContent =
      format === 'instructions-only' ? skill.instructions : formatSkillForLLM(skill, availableTools, missingTools);

    const output: Output = {
      skill: {
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
      },
      availableTools,
      missingTools,
      isComplete,
      warning,
      formattedContent,
    };

    // Add session info if activation was requested
    if (activateSession) {
      if (activationResult) {
        output.session = {
          activated: true,
          sessionId: activationResult.session.sessionId,
          policyMode: activationResult.session.policyMode,
          allowedTools: activationResult.availableTools,
        };
      } else {
        output.session = {
          activated: false,
        };
      }
    }

    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
