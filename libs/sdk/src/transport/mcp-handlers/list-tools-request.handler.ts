import { ListToolsRequestSchema, ListToolsRequest, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listToolsRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListToolsRequest, ListToolsResult> {
  const logger = scope.logger.child('list-tools-request-handler');

  return {
    requestSchema: ListToolsRequestSchema,
    handler: async (request: ListToolsRequest, ctx) => {
      logger.debug('tools/list requested');
      try {
        return await scope.runFlowForOutput('tools:list-tools', { request, ctx });
      } catch (e) {
        logger.error('tools/list failed', {
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
