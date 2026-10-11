import { CallToolRequestSchema, type CallToolRequest, type CallToolResult } from '@frontmcp/protocol';

import { ErrorHandler } from '../../errors';
import { toolCallErrorResult } from './call-tool-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

export default function callToolRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CallToolRequest, CallToolResult> {
  const logger = scope.logger.child('call-tool-request-handler');
  const errorHandler = new ErrorHandler({ logger });

  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx) => {
      const toolName = request.params?.name || 'unknown';
      logger.info(`tools/call: ${toolName}`);
      const start = Date.now();

      try {
        // Issue #417 — tag the call ctx with the surface the request arrived on
        // (`'mcp'`, or `'cli'` for a CLI build's in-process client) so the tool
        // flow answers a tool whose `availableWhen.surface` excludes it like an
        // unknown tool.
        const taggedCtx = withMcpSurface(scope, ctx as Record<string, unknown>);
        const result = await scope.runFlowForOutput('tools:call-tool', { request, ctx: taggedCtx });
        logger.verbose('tools/call completed', { tool: toolName, durationMs: Date.now() - start });
        return result;
      } catch (e) {
        return toolCallErrorResult(e, { errorHandler, toolName, logger });
      }
    },
  } satisfies McpHandler<CallToolRequest, CallToolResult>;
}
