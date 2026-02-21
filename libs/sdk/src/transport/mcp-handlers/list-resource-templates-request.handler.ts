// file: libs/sdk/src/transport/mcp-handlers/list-resource-templates-request.handler.ts

import {
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listResourceTemplatesRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListResourceTemplatesRequest, ListResourceTemplatesResult> {
  const logger = scope.logger.child('list-resource-templates-request-handler');

  return {
    requestSchema: ListResourceTemplatesRequestSchema,
    handler: async (request: ListResourceTemplatesRequest, ctx) => {
      logger.debug('resources/listTemplates requested');
      try {
        return await scope.runFlowForOutput('resources:list-resource-templates', { request, ctx });
      } catch (e) {
        logger.error('resources/listTemplates failed', {
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
