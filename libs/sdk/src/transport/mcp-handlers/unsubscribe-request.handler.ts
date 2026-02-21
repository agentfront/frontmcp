import { UnsubscribeRequestSchema, UnsubscribeRequest, EmptyResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

/**
 * Handler for the resources/unsubscribe MCP request.
 * Per MCP 2025-11-25 spec, this allows clients to unsubscribe from
 * receiving notifications about a specific resource.
 */
export default function UnsubscribeRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: UnsubscribeRequestSchema,
    handler: async (request: UnsubscribeRequest, ctx): Promise<EmptyResult> => {
      const { uri } = request.params;

      // Get session ID from auth context
      const sessionId = ctx.authInfo?.sessionId;
      if (!sessionId) {
        scope.logger.warn('resources/unsubscribe: No session ID found in request context');
        return {};
      }

      // Unsubscribe the session from the resource
      const wasSubscribed = scope.notifications.unsubscribeResource(sessionId, uri);

      if (wasSubscribed) {
        scope.logger.info(`resources/unsubscribe: Session ${sessionId.slice(0, 20)}... unsubscribed from ${uri}`);
      } else {
        scope.logger.debug(`resources/unsubscribe: Session ${sessionId.slice(0, 20)}... was not subscribed to ${uri}`);
      }

      // Per MCP spec, return empty result
      return {};
    },
  } satisfies McpHandler<UnsubscribeRequest, EmptyResult>;
}
