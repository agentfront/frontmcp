import {
  CallToolRequest,
  CallToolRequestSchema,
  CallToolResult,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { formatMcpErrorResponse, InternalMcpError } from '../../errors';
import { FlowControl } from '../../common';

export default function callToolRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CallToolRequest, CallToolResult> {
  const logger = scope.logger.child('call-tool-request-handler');

  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx) => {
      const toolName = request.params?.name || 'unknown';
      logger.verbose(`tools/call: ${toolName}`);

      try {
        // All tool calls go through the standard tool flow
        // Agents are registered as regular tools with custom execute functions
        return await scope.runFlowForOutput('tools:call-tool', { request, ctx });
      } catch (e) {
        // FlowControl is a control flow mechanism, not an error - handle silently
        if (e instanceof FlowControl) {
          if (e.type === 'respond') {
            // Validate output using MCP schema
            const parseResult = CallToolResultSchema.safeParse(e.output);
            if (parseResult.success) {
              return parseResult.data;
            }
            logger.error('FlowControl.respond has invalid output', {
              tool: toolName,
              validationErrors: parseResult.error.issues,
            });
            return formatMcpErrorResponse(new InternalMcpError('FlowControl output is not a valid CallToolResult'));
          }
          // For handled, next, abort, fail - return appropriate response
          logger.warn(`FlowControl ended with type: ${e.type}`, { tool: toolName, type: e.type, output: e.output });
          return formatMcpErrorResponse(new InternalMcpError(`Flow ended with: ${e.type}`));
        }

        // Log detailed error info
        logger.error('CallTool Failed', {
          tool: toolName,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        return formatMcpErrorResponse(e);
      }
    },
  } satisfies McpHandler<CallToolRequest, CallToolResult>;
}
