import { CallToolRequest, CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { formatMcpErrorResponse } from '../../errors';

export default function callToolRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CallToolRequest, CallToolResult> {
  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx) => {
      try {
        return await scope.runFlowForOutput('tools:call-tool', { request, ctx });
      } catch (e) {
        scope.logger.error("CallTool Failed", e);
        return formatMcpErrorResponse(e);
      }
    },
  } satisfies McpHandler<CallToolRequest, CallToolResult>;
}
