// file: libs/sdk/src/transport/mcp-handlers/read-resource-request.handler.ts

import { ReadResourceRequestSchema, ReadResourceRequest, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function readResourceRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: ReadResourceRequestSchema,
    handler: (request: ReadResourceRequest, ctx) => scope.runFlowForOutput('resources:read-resource', { request, ctx }),
  } satisfies McpHandler<ReadResourceRequest, ReadResourceResult>;
}
