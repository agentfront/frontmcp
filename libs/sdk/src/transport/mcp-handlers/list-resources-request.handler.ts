// file: libs/sdk/src/transport/mcp-handlers/list-resources-request.handler.ts

import {
  ListResourcesRequestSchema,
  ListResourcesRequest,
  ListResourcesResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listResourcesRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: ListResourcesRequestSchema,
    handler: (request: ListResourcesRequest, ctx) =>
      scope.runFlowForOutput('resources:list-resources', { request, ctx }),
  } satisfies McpHandler<ListResourcesRequest, ListResourcesResult>;
}
