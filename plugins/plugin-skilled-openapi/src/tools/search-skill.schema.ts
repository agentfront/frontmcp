import { z } from '@frontmcp/lazy-zod';

export const searchSkillDescription = `Search the available skills by free-form query.

A "skill" is a curated bundle of REST operations exposed to you behind a single
named capability — instead of seeing each individual API endpoint, you see one
skill that knows how to do something useful (e.g. "billing", "customers"). Use
this tool first to discover what skills exist for the user's request, then call
\`load_skill\` to read its instructions + the actions it offers, and \`run_workflow\`
to execute — a short sandboxed script that calls the skill's actions via
\`callTool(actionId, input)\` (chaining several in one round-trip).

INPUT:
- query: short natural-language description of what you want to do
- limit?: max results (default 20, max 50)
- tags?: filter to skills carrying these tags
- notQuery?: anti-query — describe what you do NOT want; matching skills are
  demoted (e.g. query "rate limiting", notQuery "enforcement" to prefer guidance
  over enforcement skills)

OUTPUT: { skills: Array<{ skillId, name, description, score }> }`;

export const searchSkillInputSchema = {
  query: z.string().min(1).max(2048).describe('Natural-language search query'),
  limit: z.number().int().positive().max(50).optional().describe('Max results (default 20)'),
  tags: z.array(z.string().min(1).max(64)).max(16).optional().describe('Filter by tags'),
  notQuery: z
    .union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).max(8)])
    .optional()
    .describe('Anti-query: skills matching this are demoted in ranking'),
  notWeight: z.number().positive().max(10).optional().describe('Strength of the anti-query demotion (default 1)'),
};

export const searchSkillOutputSchema = {
  skills: z.array(
    z.object({
      skillId: z.string(),
      name: z.string(),
      description: z.string(),
      score: z.number(),
      bundleVersion: z.string().optional(),
    }),
  ),
};

export type SearchSkillInput = {
  query: string;
  limit?: number;
  tags?: string[];
  notQuery?: string | string[];
  notWeight?: number;
};

export type SearchSkillOutput = {
  skills: Array<{
    skillId: string;
    name: string;
    description: string;
    score: number;
    bundleVersion?: string;
  }>;
};
