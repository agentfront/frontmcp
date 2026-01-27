import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import {
  SkillsListRequestSchema,
  SkillsListResultSchema,
  SkillsListRequest,
  SkillsListResult,
} from './skills-mcp.types';
import { PublicMcpError } from '../../errors';

/**
 * MCP handler for skills/list custom method.
 *
 * Allows MCP clients to list all available skills.
 */
export default function skillsListRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsListRequest, SkillsListResult> {
  const logger = scope.logger.child('skills-list-request-handler');

  return {
    requestSchema: SkillsListRequestSchema,
    responseSchema: SkillsListResultSchema,
    handler: async (request: SkillsListRequest) => {
      const params = request.params ?? {};
      const { offset, limit, tags, sortBy, sortOrder, includeHidden } = params;
      logger.verbose(`skills/list: offset=${offset}, limit=${limit}`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
      }

      // List skills using the registry
      const listResult = await skillRegistry.listSkills({
        offset,
        limit,
        tags,
        sortBy,
        sortOrder,
        includeHidden,
      });

      // Transform to response format
      const skills = listResult.skills.map((s) => ({
        id: s.id ?? s.name,
        name: s.name,
        description: s.description ?? '',
        tags: s.tags,
        priority: s.priority,
      }));

      const result = {
        skills,
        total: listResult.total,
        hasMore: listResult.hasMore,
      };

      // Validate result against schema
      return SkillsListResultSchema.parse(result) as SkillsListResult;
    },
  };
}
