import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import {
  SkillsSearchRequestSchema,
  SkillsSearchResultSchema,
  SkillsSearchRequest,
  SkillsSearchResult,
} from './skills-mcp.types';
import { extractToolNames } from '../../common/metadata/skill.metadata';
import { PublicMcpError } from '../../errors';

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
    responseSchema: SkillsSearchResultSchema,
    handler: async (request: SkillsSearchRequest) => {
      const { query, tags, tools, limit, requireAllTools } = request.params;
      logger.verbose(`skills/search: "${query}"`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
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

      const result = {
        skills,
        total,
        hasMore,
        guidance,
      };

      // Validate result against schema
      return SkillsSearchResultSchema.parse(result);
    },
  };
}
