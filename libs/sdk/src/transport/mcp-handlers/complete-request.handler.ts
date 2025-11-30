import { CompleteRequestSchema, CompleteRequest, CompleteResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function CompleteRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: CompleteRequestSchema,
    handler: (request: CompleteRequest, ctx) => scope.runFlowForOutput('completion:complete', { request, ctx }),
  } satisfies McpHandler<CompleteRequest, CompleteResult>;
}
