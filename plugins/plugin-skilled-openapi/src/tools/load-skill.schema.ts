import { z } from '@frontmcp/lazy-zod';

/** The most skills one \`load_skill\` call loads. */
export const MAX_SKILLS_PER_LOAD = 10;

export const loadSkillDescription = `Load the full instructions and executable actions of one or more skills.

Pass the name the \`search_skill\` catalog shows, or a \`skillId\` from a search
result. Load several skills at once with \`skillIds\` (up to ${MAX_SKILLS_PER_LOAD}).

Load each skill once per conversation: its instructions and actions stay in your
context, so use them from there for the next steps of the task. Load it again
only when its \`bundleVersion\` changed (\`search_skill\` results report the
current one), or when its content is no longer in your context.

The returned object contains:
  - \`instructions\`: markdown to read before running an action
  - \`actions\`: each action's input/output JSON Schema and required authorities;
    run one with \`execute_action\`, or chain several with \`run_workflow\`
  - \`bundleVersion\`: changes when the bundle is hot-swapped

INPUT: { skillId } or { skillIds }
OUTPUT: { skill: { id, name, description, instructions, actions[] }, isComplete } for skillId,
        { skills: Array<{ skill, isComplete }> } for skillIds`;

const loadedSkillSchema = z.object({
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
});

export const loadSkillInputSchema = {
  skillId: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Name or id of the skill to load (the catalog shows names; search_skill returns ids)'),
  skillIds: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(MAX_SKILLS_PER_LOAD)
    .optional()
    .describe(`Names or ids of several skills to load at once (up to ${MAX_SKILLS_PER_LOAD}), in place of skillId`),
};

export const loadSkillOutputSchema = {
  skill: loadedSkillSchema.optional(),
  isComplete: z.boolean().optional(),
  warning: z.string().optional(),
  skills: z
    .array(z.object({ skill: loadedSkillSchema, isComplete: z.boolean(), warning: z.string().optional() }))
    .optional(),
};

export type LoadSkillInput = { skillId?: string; skillIds?: string[] };

export type LoadedSkill = {
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

export type LoadSkillResult = { skill: LoadedSkill; isComplete: boolean; warning?: string };

/** One skill's answer for \`skillId\`, or every skill's under \`skills\` for \`skillIds\`. */
export type LoadSkillOutput = Partial<LoadSkillResult> & { skills?: LoadSkillResult[] };
