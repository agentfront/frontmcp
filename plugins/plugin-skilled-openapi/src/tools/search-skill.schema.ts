import { z } from '@frontmcp/lazy-zod';

export const searchSkillDescription = `Search the available skills by free-form query.

A "skill" is a curated bundle of REST operations exposed to you behind a single
named capability — instead of seeing each individual API endpoint, you see one
skill that knows how to do something useful (e.g. "billing", "customers"). Use
this tool first to discover what skills exist for the user's request, then call
\`load_skill\` to read its instructions + the actions it offers, and \`execute_action\`
to actually invoke one.

INPUT:
- query: short natural-language description of what you want to do
- limit?: max results (default 20, max 50)
- tags?: filter to skills carrying these tags

OUTPUT: { skills: Array<{ skillId, name, description, score }> }`;

export const searchSkillInputSchema = {
  query: z.string().min(1).max(2048).describe('Natural-language search query'),
  limit: z.number().int().positive().max(50).optional().describe('Max results (default 20)'),
  tags: z.array(z.string().min(1).max(64)).max(16).optional().describe('Filter by tags'),
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
