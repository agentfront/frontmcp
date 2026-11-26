// file: libs/plugins/src/codecall/tools/search-knowledge.schema.ts
//
// Schema for `codecall:searchKnowledge` — surfaces KNOWLEDGE-ONLY skills
// (no tools, no referenced openapi operations). These skills carry domain
// context (refund policy, eligibility matrices, glossary, runbooks) that
// the agent should load BEFORE attempting an executable action.

import { z } from '@frontmcp/lazy-zod';

export const searchKnowledgeToolDescription = `Search for KNOWLEDGE-ONLY skills — domain context the agent should read before deciding what to do. These skills have no tools and no openapi operation refs; they are pure prose / references / examples.

USE WHEN: the agent needs background to interpret a request, validate eligibility, or recall a procedure that isn't yet executable.

INPUT:
- queries: string[] (required) - atomic context queries, max 10
- tags?: string[] - filter to knowledge carrying any of these tags
- excludeSkillNames?: string[] - skip already-loaded knowledge
- topK?: number (default 5) - results per query
- minRelevanceScore?: number (default 0.1) - minimum match threshold

OUTPUT: Deduplicated knowledge skill list with description + tags. To read the body, follow up with describe(skillName) or the skill:// resource URI.

FLOW: searchKnowledge → describe (for body) → continue with searchSkills`;

export const searchKnowledgeToolInputSchema = {
  queries: z.array(z.string().min(2).max(256)).min(1).max(10).describe('Atomic context queries.'),
  tags: z.array(z.string().min(1).max(64)).max(16).optional().describe('Filter to skills with any of these tags'),
  excludeSkillNames: z.array(z.string()).max(50).optional().describe('Skip already-loaded knowledge skill names'),
  topK: z.number().int().positive().max(50).optional().default(5).describe('Results per query (default 5)'),
  minRelevanceScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.1)
    .describe('Minimum relevance threshold (default 0.1)'),
};

export type SearchKnowledgeToolInput = z.infer<z.ZodObject<typeof searchKnowledgeToolInputSchema>>;

const knowledgeHitSchema = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  relevanceScore: z.number().min(0).max(1),
  matchedQueries: z.array(z.string()),
  source: z.enum(['local', 'external']),
});

export const searchKnowledgeToolOutputSchema = z.object({
  knowledge: z.array(knowledgeHitSchema),
  warnings: z.array(
    z.object({
      type: z.enum(['no_results', 'low_relevance', 'excluded_skill_not_found']),
      message: z.string(),
      affectedSkills: z.array(z.string()).optional(),
    }),
  ),
  totalKnowledgeSkills: z.number().int().nonnegative(),
});

export type SearchKnowledgeToolOutput = z.infer<typeof searchKnowledgeToolOutputSchema>;
