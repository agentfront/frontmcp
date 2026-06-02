import { PublicMcpError } from '../../errors';
import { filterSkillMetadataByAuthorities } from '../../skill/skill-authorities.helper';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import {
  SkillsListRequestSchema,
  SkillsListResultSchema,
  type SkillsListRequest,
  type SkillsListResult,
} from './skills-mcp.types';

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
    handler: async (request: SkillsListRequest, ctx) => {
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

      // Entry-level authorities: hide gated skills the caller can't discover.
      // listResult.skills are flat SkillMetadata; wrap as { metadata } for the
      // shared resolver, then unwrap. No-op when no engine is configured, in
      // which case the page and its `total` are returned exactly as before.
      const authInfo = (ctx?.authInfo ?? {}) as Record<string, unknown>;
      const wrapped = listResult.skills.map((metadata) => ({ metadata }));
      const visible = await filterSkillMetadataByAuthorities(scope, skillRegistry, wrapped, authInfo);
      const removed = listResult.skills.length - visible.length;

      // Transform to response format
      const skills = visible.map(({ metadata: s }) => ({
        id: s.id ?? s.name,
        name: s.name,
        description: s.description ?? '',
        tags: s.tags,
        priority: s.priority,
      }));

      const result = {
        skills,
        // Subtract only the skills hidden from THIS page so the count stays
        // consistent with the returned page; unchanged when nothing is gated.
        total: listResult.total - removed,
        hasMore: listResult.hasMore,
      };

      // Validate result against schema
      return SkillsListResultSchema.parse(result);
    },
  };
}
