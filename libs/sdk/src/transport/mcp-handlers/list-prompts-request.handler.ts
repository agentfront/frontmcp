import { ListPromptsRequestSchema, ListPromptsRequest, ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listPromptsRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListPromptsRequest, ListPromptsResult> {
  const logger = scope.logger.child('list-prompts-request-handler');

  return {
    requestSchema: ListPromptsRequestSchema,
    handler: async (request: ListPromptsRequest, ctx) => {
      logger.debug('prompts/list requested');
      try {
        return await scope.runFlowForOutput('prompts:list-prompts', { request, ctx });
      } catch (e) {
        logger.error('prompts/list failed', {
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
