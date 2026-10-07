import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';
import {
  SkillsLoadRequestSchema,
  SkillsLoadResultSchema,
  type SkillsLoadRequest,
  type SkillsLoadResult,
} from './skills-mcp.types';

/**
 * MCP handler for skills/load custom method: runs the `skills:load` flow.
 *
 * Allows MCP clients to load skills by ID with full content.
 */
export default function skillsLoadRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsLoadRequest, SkillsLoadResult> {
  const logger = scope.logger.child('skills-load-request-handler');

  return {
    requestSchema: SkillsLoadRequestSchema,
    responseSchema: SkillsLoadResultSchema,
    handler: async (request: SkillsLoadRequest, ctx) => {
      logger.verbose(`skills/load: [${request.params.skillIds.join(', ')}]`);
      try {
        // A denied skill keeps its MCP code (AuthorityDeniedError: -32003), as a denied tools/call does
        return await scope.runFlowForOutput('skills:load', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
