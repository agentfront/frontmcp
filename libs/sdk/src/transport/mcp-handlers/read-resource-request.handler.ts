// file: libs/sdk/src/transport/mcp-handlers/read-resource-request.handler.ts

import { ReadResourceRequestSchema, ReadResourceRequest, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function readResourceRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ReadResourceRequest, ReadResourceResult> {
  const logger = scope.logger.child('read-resource-request-handler');

  return {
    requestSchema: ReadResourceRequestSchema,
    handler: async (request: ReadResourceRequest, ctx) => {
      const uri = request.params?.uri || 'unknown';
      logger.verbose(`resources/read: ${uri}`);
      try {
        return await scope.runFlowForOutput('resources:read-resource', { request, ctx });
      } catch (e) {
        logger.error('resources/read failed', {
          uri,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
