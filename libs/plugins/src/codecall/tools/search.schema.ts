// file: libs/plugins/src/codecall/tools/search.schema.ts
import { z } from 'zod';

export const searchToolInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural language description of what tools you need. Be specific about the functionality you are looking for.',
    ),
  filter: z
    .object({
      appIds: z
        .array(z.string())
        .optional()
        .describe(
          'Optional array of app IDs to search within. If not provided, searches across all apps. Use this to narrow down results to specific domains (e.g., ["user", "billing"]).',
        ),
    })
    .optional()
    .describe('Optional filters to narrow down the search scope.'),
  excludeToolNames: z
    .array(z.string())
    .optional()
    .describe(
      'Array of tool names you have ALREADY fetched or described in this conversation. These tools will be excluded from search results to avoid redundant lookups. IMPORTANT: Only include tools you have actually searched for or described before - do not guess or assume tool names.',
    ),
  topK: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .default(8)
    .describe('Maximum number of matching tools to return. Defaults to 8. Maximum value is 50.'),
});

export type SearchToolInput = z.infer<typeof searchToolInputSchema>;

export const searchToolOutputSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string().describe('The unique name of the tool (e.g., "users:list", "billing:getInvoice")'),
        appId: z.string().describe('The app ID this tool belongs to'),
        description: z.string().describe('Brief description of what this tool does'),
        relevanceScore: z
          .number()
          .min(0)
          .max(1)
          .describe('Relevance score between 0 and 1, where 1 is most relevant to your query'),
      }),
    )
    .describe('Array of matching tools, sorted by relevance (most relevant first)'),
  warnings: z
    .array(
      z.object({
        type: z.enum(['excluded_tool_not_found', 'no_results', 'partial_results']).describe('Type of warning'),
        message: z.string().describe('Human-readable warning message'),
        affectedTools: z
          .array(z.string())
          .optional()
          .describe('Tool names affected by this warning (for excluded_tool_not_found warnings)'),
      }),
    )
    .describe(
      'Warnings about the search operation. Check this for: 1) Excluded tools that do not exist in the index, 2) Empty results, 3) Partial results due to filtering',
    ),
  totalAvailableTools: z
    .number()
    .int()
    .nonnegative()
    .describe('Total number of tools available in the search scope (before excluding and limiting to topK)'),
});

export type SearchToolOutput = z.infer<typeof searchToolOutputSchema>;
