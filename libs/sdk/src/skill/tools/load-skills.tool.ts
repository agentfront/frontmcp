// file: libs/sdk/src/skill/tools/load-skills.tool.ts

import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { formatSkillForLLM, generateNextSteps } from '../skill.utils';
import { formatSkillForLLMWithSchemas } from '../skill-http.utils';
import type { ToolRegistryInterface } from '../../common';

/**
 * Input schema for loadSkills tool.
 */
const inputSchema = {
  skillIds: z.array(z.string().min(1)).min(1).max(5).describe('Array of skill IDs to load (1-5 skills)'),
  format: z
    .enum(['full', 'instructions-only'])
    .default('full')
    .describe(
      'Output format: full (all details including tool schemas) or instructions-only (just the workflow steps)',
    ),
};

/**
 * Tool info with optional schemas.
 */
interface ToolInfo {
  name: string;
  purpose?: string;
  available: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

/**
 * Single skill result structure.
 */
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
      inputSchema: z.unknown().optional().describe('JSON Schema for tool input parameters'),
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
  formattedContent: z.string().describe('Formatted skill content with tool schemas for LLM consumption'),
});

/**
 * Output schema for loadSkills tool.
 */
const outputSchema = {
  skills: z.array(skillResultSchema),
  summary: z.object({
    totalSkills: z.number(),
    totalTools: z.number(),
    allToolsAvailable: z.boolean(),
    combinedWarnings: z.array(z.string()).optional(),
  }),
  nextSteps: z.string().describe('Guidance on what to do next with the loaded skills'),
};

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

/**
 * Tool for loading one or more skills' full content.
 *
 * This tool retrieves skill instructions, tool requirements, and parameters.
 * Use this after searching for skills to get the detailed workflow guides.
 *
 * @example
 * ```typescript
 * // Load a single skill by ID
 * const result = await loadSkills({ skillIds: ['review-pr'] });
 *
 * // Load multiple related skills
 * const result = await loadSkills({ skillIds: ['review-pr', 'suggest-fixes'] });
 *
 * // Get instructions only (shorter response)
 * const result = await loadSkills({ skillIds: ['deploy-app'], format: 'instructions-only' });
 * ```
 */
@Tool({
  name: 'loadSkills',
  description:
    'Load the complete workflow details for one or more skills. ' +
    'This tool returns everything you need to execute a skill:\n\n' +
    '**What you get:**\n' +
    '- Step-by-step instructions for each skill\n' +
    '- List of MCP tools used by each skill with their input/output schemas\n' +
    '- Parameters needed to customize the workflow\n' +
    '- Availability status for each tool (available/missing)\n\n' +
    '**When to use:**\n' +
    '- After finding a relevant skill with searchSkills\n' +
    '- When combining multiple related skills (e.g., "review-pr" + "suggest-fixes")\n' +
    '- When you need the full tool schemas to understand how to call tools\n\n' +
    '**Output format:**\n' +
    '- formattedContent: Markdown-formatted instructions ready to follow\n' +
    '- tools[].inputSchema: JSON Schema showing exactly what parameters each tool expects\n' +
    '- nextSteps: Suggested actions after loading\n\n' +
    '**Example flow:**\n' +
    '1. searchSkills({ query: "deploy to kubernetes" })\n' +
    '2. loadSkills({ skillIds: ["k8s-deploy", "health-check"] })\n' +
    '3. Follow the instructions, calling the listed tools with the schemas provided',
  inputSchema,
  outputSchema,
  tags: ['skills', 'workflow', 'entry-point'],
  annotations: {
    title: 'Load Skills',
    readOnlyHint: true,
  },
})
export class LoadSkillsTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      this.fail(new Error('Skills are not available in this scope'));
    }

    const results: z.infer<typeof skillResultSchema>[] = [];
    const allWarnings: string[] = [];
    let totalTools = 0;
    let allToolsAvailable = true;

    // Get tool registry for schemas
    const toolRegistry: ToolRegistryInterface | undefined = this.scope.tools;

    for (const skillId of input.skillIds) {
      const result = await skillRegistry.loadSkill(skillId);
      if (!result) {
        allWarnings.push(`Skill "${skillId}" not found`);
        continue;
      }

      const { skill, availableTools, missingTools, isComplete, warning } = result;

      // Build tools array with availability and schemas
      const tools: ToolInfo[] = skill.tools.map((t) => {
        const isAvailable = availableTools.includes(t.name);
        const toolResult: ToolInfo = {
          name: t.name,
          purpose: t.purpose,
          available: isAvailable,
        };

        // Include schemas for available tools
        if (isAvailable && toolRegistry) {
          const toolEntry = toolRegistry.getTools(true).find((te) => te.name === t.name);
          if (toolEntry) {
            const rawInput = toolEntry.getInputJsonSchema?.() ?? toolEntry.rawInputSchema;
            if (rawInput) {
              toolResult.inputSchema = rawInput;
            }
            const rawOutput = toolEntry.getRawOutputSchema?.() ?? toolEntry.rawOutputSchema;
            if (rawOutput) {
              toolResult.outputSchema = rawOutput;
            }
          }
        }

        return toolResult;
      });

      totalTools += tools.length;
      if (missingTools.length > 0) allToolsAvailable = false;
      if (warning) allWarnings.push(warning);

      // Format content
      let formattedContent: string;
      if (input.format === 'instructions-only') {
        formattedContent = skill.instructions;
      } else if (toolRegistry) {
        formattedContent = formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry);
      } else {
        formattedContent = formatSkillForLLM(skill, availableTools, missingTools);
      }

      results.push({
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
      });
    }

    // Generate next steps guidance
    const nextSteps = generateNextSteps(
      results.map((r) => ({
        name: r.name,
        isComplete: r.isComplete,
        tools: r.tools,
      })),
      allToolsAvailable,
    );

    return {
      skills: results,
      summary: {
        totalSkills: results.length,
        totalTools,
        allToolsAvailable,
        combinedWarnings: allWarnings.length > 0 ? allWarnings : undefined,
      },
      nextSteps,
    };
  }
}
