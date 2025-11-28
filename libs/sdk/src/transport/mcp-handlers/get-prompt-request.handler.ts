import { GetPromptRequestSchema, GetPromptRequest, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function GetPromptRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: GetPromptRequestSchema,
    handler: (request: GetPromptRequest, ctx) => scope.runFlowForOutput('prompts:get-prompt', { request, ctx }),
  } satisfies McpHandler<GetPromptRequest, GetPromptResult>;
}
