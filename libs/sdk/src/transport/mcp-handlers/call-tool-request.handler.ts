import { CallToolRequest, CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { formatMcpErrorResponse } from '../../errors';
import { FlowControl } from '../../common';

export default function callToolRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CallToolRequest, CallToolResult> {
  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx) => {
      try {
        return await scope.runFlowForOutput('tools:call-tool', { request, ctx });
      } catch (e) {
        // FlowControl is a control flow mechanism, not an error - handle silently
        if (e instanceof FlowControl) {
          if (e.type === 'respond') {
            return e.output as CallToolResult;
          }
          // For handled, next, abort, fail - return appropriate response
          return formatMcpErrorResponse(new Error(`Flow ended with: ${e.type}`));
        }
        scope.logger.error('CallTool Failed', e);
        return formatMcpErrorResponse(e);
      }
    },
  } satisfies McpHandler<CallToolRequest, CallToolResult>;
}
