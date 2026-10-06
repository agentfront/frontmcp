import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';
import {
  SkillsSearchRequestSchema,
  SkillsSearchResultSchema,
  type SkillsSearchRequest,
  type SkillsSearchResult,
} from './skills-mcp.types';

/**
 * MCP handler for skills/search custom method: runs the `skills:search` flow.
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
    handler: async (request: SkillsSearchRequest, ctx) => {
      logger.verbose(`skills/search: "${request.params.query}"`);
      try {
        return await scope.runFlowForOutput('skills:search', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
