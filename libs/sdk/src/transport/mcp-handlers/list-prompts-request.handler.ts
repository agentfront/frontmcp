import { ListPromptsRequestSchema, ListPromptsRequest, ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function ListPromptsRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: ListPromptsRequestSchema,
    handler: (request: ListPromptsRequest, ctx) => scope.runFlowForOutput('prompts:list-prompts', { request, ctx }),
  } satisfies McpHandler<ListPromptsRequest, ListPromptsResult>;
}
