import { z } from '@frontmcp/lazy-zod';

export const loadSkillDescription = `Load the full instructions and executable actions for a specific skill.

Use this AFTER \`search_skill\` once you've identified the right skill for the
user's task. The returned object contains:
  - \`instructions\`: markdown the LLM should read carefully before invoking
  - \`actions\`: each action's input/output JSON Schema and required authorities
  - \`bundleVersion\`: changes when the bundle is hot-swapped (use it to detect drift)

INPUT: { skillId }
OUTPUT: { skill: { id, name, description, instructions, actions[] }, isComplete }`;

export const loadSkillInputSchema = {
  skillId: z.string().min(1).max(256).describe('Stable skill identifier (returned by search_skill)'),
};

export const loadSkillOutputSchema = {
  skill: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    bundleVersion: z.string().optional(),
    actions: z
      .array(
        z.object({
          actionId: z.string(),
          summary: z.string(),
          description: z.string().optional(),
          inputJsonSchema: z.record(z.string(), z.unknown()),
          outputJsonSchema: z.record(z.string(), z.unknown()),
          requiredAuthorities: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
  }),
  isComplete: z.boolean(),
  warning: z.string().optional(),
};

export type LoadSkillInput = { skillId: string };
export type LoadSkillOutput = {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    bundleVersion?: string;
    actions?: Array<{
      actionId: string;
      summary: string;
      description?: string;
      inputJsonSchema: Record<string, unknown>;
      outputJsonSchema: Record<string, unknown>;
      requiredAuthorities?: Record<string, unknown>;
    }>;
  };
  isComplete: boolean;
  warning?: string;
};
