import {ListToolsRequestSchema, ListToolsRequest, ListToolsResult,} from '@modelcontextprotocol/sdk/types.js';
import {McpHandler, McpHandlerOptions} from './mcp-handlers.types';

export default function ListToolsRequestHandler({scope,}: McpHandlerOptions) {
  return {
    requestSchema: ListToolsRequestSchema,
    handler: (request: ListToolsRequest, ctx) => scope.runFlowForOutput('tools:list-tools', {request, ctx})
  } satisfies McpHandler<ListToolsRequest, ListToolsResult>
}
