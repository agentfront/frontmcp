// file: libs/plugins/src/codecall/tools/search-skills.schema.ts
//
// Schema for `codecall:searchSkills` — the new meta-tool that surfaces
// EXECUTABLE skills (skills that declare tools or referenced openapi
// operations) so the agent can author AgentScript against their bindings
// without a follow-up `describe` roundtrip.
//
// Companion to `codecall:searchKnowledge` which surfaces pure-knowledge
// skills (no tools, no op refs) — useful as context but not callable.

import { z } from '@frontmcp/lazy-zod';

export const searchSkillsToolDescription = `Search for EXECUTABLE skills. Each result returns the skill's description, tags, and the openapi operation IDs it can call from within AgentScript.

DECOMPOSE complex requests into atomic queries. AVOID re-searching: use excludeSkillNames.

INPUT:
- queries: string[] (required) - atomic skill descriptions, max 10
- tags?: string[] - filter to skills carrying any of these tags
- excludeSkillNames?: string[] - skip already-discovered skills
- topK?: number (default 5) - results per query
- minRelevanceScore?: number (default 0.1) - minimum match threshold

OUTPUT: Flat deduplicated executable skill list. Each entry includes the operationIds the skill is allowed to call (via the markdown harvester). The agent can use those operationIds directly in execute() AgentScript via the generated namespaces (e.g. acme.getOrder({...})).

FLOW: searchSkills → describe → execute`;

export const searchSkillsToolInputSchema = {
  queries: z
    .array(z.string().min(2).max(256))
    .min(1)
    .max(10)
    .describe('Atomic skill queries. Split complex requests into simple actions.'),
  tags: z.array(z.string().min(1).max(64)).max(16).optional().describe('Filter to skills with any of these tags'),
  excludeSkillNames: z.array(z.string()).max(50).optional().describe('Skip already-known skill names'),
  topK: z.number().int().positive().max(50).optional().default(5).describe('Results per query (default 5)'),
  minRelevanceScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.1)
    .describe('Minimum relevance threshold (default 0.1)'),
};

export type SearchSkillsToolInput = z.infer<z.ZodObject<typeof searchSkillsToolInputSchema>>;

const referencedOperationSchema = z.object({
  spec: z.string().describe('OpenAPI spec id (e.g. "acme")'),
  operationId: z.string().describe('OpenAPI operation id (e.g. "getOrder")'),
});

const skillSearchHitSchema = z.object({
  name: z.string().describe('Skill name'),
  description: z.string().describe('Short description of what the skill does'),
  tags: z.array(z.string()).describe('Tags carried by the skill'),
  /**
   * OpenAPI operations the skill is allowed to call. Inlined so the agent
   * can author AgentScript from a single search response.
   */
  operations: z.array(referencedOperationSchema).describe('OpenAPI operations the skill can call'),
  /** Decorator-declared tools (for skills built the legacy way). */
  tools: z.array(z.string()).describe('Tool names the skill declares (if any)'),
  relevanceScore: z.number().min(0).max(1).describe('Match score (0-1)'),
  matchedQueries: z.array(z.string()).describe('Which queries matched this skill'),
  source: z.enum(['local', 'external']).describe('Where the skill was loaded from'),
});

export const searchSkillsToolOutputSchema = z.object({
  skills: z.array(skillSearchHitSchema).describe('Deduplicated executable skills, sorted by relevance'),
  warnings: z
    .array(
      z.object({
        type: z.enum(['no_results', 'low_relevance', 'excluded_skill_not_found']).describe('Warning type'),
        message: z.string().describe('Warning message'),
        affectedSkills: z.array(z.string()).optional().describe('Affected skill names'),
      }),
    )
    .describe('Search warnings'),
  totalExecutableSkills: z.number().int().nonnegative().describe('Total executable skills available'),
});

export type SearchSkillsToolOutput = z.infer<typeof searchSkillsToolOutputSchema>;
