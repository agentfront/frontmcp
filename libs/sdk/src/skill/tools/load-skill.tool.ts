// file: libs/sdk/src/skill/tools/load-skill.tool.ts

import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { formatSkillForLLM } from '../skill.utils';

/**
 * Input schema for loadSkill tool.
 */
const inputSchema = {
  skillId: z.string().min(1).describe('ID or name of the skill to load'),
  format: z
    .enum(['full', 'instructions-only'])
    .default('full')
    .describe('Output format: full (all details) or instructions-only (just the workflow steps)'),
};

/**
 * Output schema for loadSkill tool.
 */
const outputSchema = {
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
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

/**
 * Tool for loading a skill's full content.
 *
 * This tool retrieves a skill's instructions, tool requirements, and parameters.
 * Use this after searching for skills to get the detailed workflow guide.
 *
 * @example
 * ```typescript
 * // Load a skill by ID
 * const result = await loadSkill({ skillId: 'review-pr' });
 *
 * // Get instructions only (shorter response)
 * const result = await loadSkill({ skillId: 'deploy-app', format: 'instructions-only' });
 * ```
 */
@Tool({
  name: 'loadSkill',
  description:
    'Load the full content of a skill by its ID or name. ' +
    'Returns detailed instructions, required tools, and parameters. ' +
    'Use this after finding a relevant skill with searchSkills.',
  inputSchema,
  outputSchema,
  tags: ['skills', 'workflow'],
  annotations: {
    title: 'Load Skill',
    readOnlyHint: true,
  },
})
export class LoadSkillTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      this.fail(new Error('Skills are not available in this scope'));
    }

    // Load the skill
    const result = await skillRegistry.loadSkill(input.skillId);

    if (!result) {
      this.fail(new Error(`Skill "${input.skillId}" not found`));
    }

    const { skill, availableTools, missingTools, isComplete, warning } = result;

    // Build tools array with availability info
    const tools = skill.tools.map((t) => ({
      name: t.name,
      purpose: t.purpose,
      available: availableTools.includes(t.name),
    }));

    // Format content for LLM
    const formattedContent =
      input.format === 'instructions-only'
        ? skill.instructions
        : formatSkillForLLM(skill, availableTools, missingTools);

    return {
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
  }
}
