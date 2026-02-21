// file: libs/sdk/src/transport/mcp-handlers/list-resources-request.handler.ts

import {
  ListResourcesRequestSchema,
  ListResourcesRequest,
  ListResourcesResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listResourcesRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListResourcesRequest, ListResourcesResult> {
  const logger = scope.logger.child('list-resources-request-handler');

  return {
    requestSchema: ListResourcesRequestSchema,
    handler: async (request: ListResourcesRequest, ctx) => {
      logger.verbose('resources/list requested');
      const start = Date.now();
      try {
        const result = await scope.runFlowForOutput('resources:list-resources', { request, ctx });
        logger.verbose('resources/list completed', { durationMs: Date.now() - start });
        return result;
      } catch (e) {
        logger.error('resources/list failed', {
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
