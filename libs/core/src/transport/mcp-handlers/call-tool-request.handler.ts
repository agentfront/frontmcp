import {
  CallToolRequestSchema,
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import {McpHandler, McpHandlerOptions} from './mcp-handlers.types';

export default function callToolRequestHandler(
  {scope}: McpHandlerOptions,
): McpHandler<CallToolRequest, CallToolResult> {
  return {
    requestSchema: CallToolRequestSchema,
    handler: (request: CallToolRequest, ctx) =>
      scope.runFlowForOutput('tools:call-tool', {request, ctx})
  } satisfies McpHandler<CallToolRequest, CallToolResult>

}
