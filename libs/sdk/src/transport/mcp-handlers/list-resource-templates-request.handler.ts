// file: libs/sdk/src/transport/mcp-handlers/list-resource-templates-request.handler.ts

import {
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function listResourceTemplatesRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: ListResourceTemplatesRequestSchema,
    handler: (request: ListResourceTemplatesRequest, ctx) =>
      scope.runFlowForOutput('resources:list-resource-templates', { request, ctx }),
  } satisfies McpHandler<ListResourceTemplatesRequest, ListResourceTemplatesResult>;
}
