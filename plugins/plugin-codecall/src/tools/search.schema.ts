// file: libs/plugins/src/codecall/tools/search.schema.ts
import { z } from 'zod';

export const searchToolDescription = `Find tools by splitting user request into atomic actions.

DECOMPOSE: "delete users and send email" → queries: ["delete user", "send email"]
DECOMPOSE: "get order and refund" → queries: ["get order", "calculate refund"]

AVOID RE-SEARCHING: Use excludeToolNames for already-discovered tools.
RE-SEARCH WHEN: describe fails (typo?) OR execute returns tool_not_found.

INPUT:
- queries: string[] (required) - atomic action phrases, max 10
- appIds?: string[] - filter by app
- excludeToolNames?: string[] - skip known tools
- topK?: number (default 5) - results per query
- minRelevanceScore?: number (default 0.3) - minimum match threshold

OUTPUT: Flat deduplicated tool list. relevanceScore: 0.5+=good, 0.7+=strong match.

FLOW: search → describe → execute/invoke`;

export const searchToolInputSchema = {
  queries: z
    .array(z.string().min(2).max(256))
    .min(1)
    .max(10)
    .describe('Atomic action queries. Split complex requests into simple actions.'),
  appIds: z.array(z.string()).max(10).optional().describe('Filter by app IDs'),
  excludeToolNames: z.array(z.string()).max(50).optional().describe('Skip already-known tool names'),
  topK: z.number().int().positive().max(50).optional().default(10).describe('Results per query (default 10)'),
  minRelevanceScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.1)
    .describe('Minimum relevance threshold (default 0.1)'),
};

export type SearchToolInput = z.infer<z.ZodObject<typeof searchToolInputSchema>>;

export const searchToolOutputSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string().describe('Tool name (e.g., "users:list")'),
        appId: z.string().optional().describe('App ID'),
        description: z.string().describe('What this tool does'),
        relevanceScore: z.number().min(0).max(1).describe('Match score (0-1)'),
        matchedQueries: z.array(z.string()).describe('Which queries matched this tool'),
      }),
    )
    .describe('Deduplicated tools sorted by relevance'),
  warnings: z
    .array(
      z.object({
        type: z.enum(['excluded_tool_not_found', 'no_results', 'low_relevance']).describe('Warning type'),
        message: z.string().describe('Warning message'),
        affectedTools: z.array(z.string()).optional().describe('Affected tool names'),
      }),
    )
    .describe('Search warnings'),
  totalAvailableTools: z.number().int().nonnegative().describe('Total tools in index'),
});

export type SearchToolOutput = z.infer<typeof searchToolOutputSchema>;
