import { z } from 'zod';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { extractToolNames } from '../../common/metadata/skill.metadata';

/**
 * Request schema for skills/search custom MCP method.
 */
const SkillsSearchRequestSchema = z.object({
  method: z.literal('skills/search'),
  params: z.object({
    query: z.string().describe('Search query string'),
    tags: z.array(z.string()).optional().describe('Filter by specific tags'),
    tools: z.array(z.string()).optional().describe('Filter by specific tools'),
    limit: z.number().min(1).max(50).optional().describe('Maximum results (1-50, default: 10)'),
    requireAllTools: z.boolean().optional().describe('Require all specified tools'),
  }),
});

type SkillsSearchRequest = z.infer<typeof SkillsSearchRequestSchema>;

/**
 * Response schema for skills/search.
 */
const SkillsSearchResultSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      score: z.number(),
      tags: z.array(z.string()).optional(),
      tools: z.array(z.object({ name: z.string(), available: z.boolean() })),
      source: z.enum(['local', 'external']),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
  guidance: z.string(),
});

type SkillsSearchResult = z.infer<typeof SkillsSearchResultSchema>;

/**
 * MCP handler for skills/search custom method.
 *
 * Allows MCP clients to search for skills by query.
 */
export default function skillsSearchRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsSearchRequest, SkillsSearchResult> {
  const logger = scope.logger.child('skills-search-request-handler');

  return {
    requestSchema: SkillsSearchRequestSchema,
    handler: async (request: SkillsSearchRequest) => {
      const { query, tags, tools, limit, requireAllTools } = request.params;
      logger.verbose(`skills/search: "${query}"`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new Error('Skills capability not available');
      }

      // Search skills using the registry
      const results = await skillRegistry.search(query, {
        topK: limit ?? 10,
        tags,
        tools,
        requireAllTools,
      });

      // Transform results to response format
      const skills = results.map((r) => {
        const toolNames = extractToolNames(r.metadata);
        return {
          id: r.metadata.id ?? r.metadata.name,
          name: r.metadata.name,
          description: r.metadata.description ?? '',
          score: r.score,
          tags: r.metadata.tags,
          tools: toolNames.map((name) => ({
            name,
            available: r.availableTools.includes(name),
          })),
          source: r.source,
        };
      });

      const total = skills.length;
      const hasMore = false; // Search doesn't support pagination

      const guidance =
        total > 0
          ? `Found ${total} matching skill(s). Use skills/load with skill IDs to load full content.`
          : 'No matching skills found. Try different search terms or list all skills with skills/list.';

      return {
        skills,
        total,
        hasMore,
        guidance,
      };
    },
  };
}
