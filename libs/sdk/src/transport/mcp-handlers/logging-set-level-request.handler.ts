import { SetLevelRequestSchema, SetLevelRequest, EmptyResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

/**
 * Handler for the logging/setLevel MCP request.
 * Per MCP 2025-11-25 spec, this allows clients to set the minimum log level
 * for log messages sent via notifications/message.
 */
export default function LoggingSetLevelRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: SetLevelRequestSchema,
    handler: async (request: SetLevelRequest, ctx): Promise<EmptyResult> => {
      const { level } = request.params;

      // Get session ID from auth context
      const sessionId = ctx.authInfo?.sessionId;
      if (!sessionId) {
        scope.logger.warn('logging/setLevel: No session ID found in request context');
        return {};
      }

      // Set the log level for this session
      const success = scope.notifications.setLogLevel(sessionId, level);

      if (!success) {
        scope.logger.warn(`logging/setLevel: Failed to set log level for session ${sessionId.slice(0, 20)}...`);
      } else {
        scope.logger.verbose(`logging/setLevel: Set level to '${level}' for session ${sessionId.slice(0, 20)}...`);
      }

      // Per MCP spec, return empty result
      return {};
    },
  } satisfies McpHandler<SetLevelRequest, EmptyResult>;
}
