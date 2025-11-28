import { SubscribeRequestSchema, SubscribeRequest, EmptyResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions, McpRequestHandler } from './mcp-handlers.types';

/**
 * Handler for the resources/subscribe MCP request.
 * Per MCP 2025-11-25 spec, this allows clients to subscribe to receive
 * notifications when a specific resource changes.
 */
export default function SubscribeRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: SubscribeRequestSchema,
    handler: async (
      request: SubscribeRequest,
      ctx: McpRequestHandler<SubscribeRequest, never>,
    ): Promise<EmptyResult> => {
      const { uri } = request.params;

      // Get session ID from auth context
      const sessionId = ctx.authInfo?.sessionId;
      if (!sessionId) {
        scope.logger.warn('resources/subscribe: No session ID found in request context');
        return {};
      }

      // Subscribe the session to the resource
      const isNew = scope.notifications.subscribeResource(sessionId, uri);

      if (isNew) {
        scope.logger.verbose(`resources/subscribe: Session ${sessionId.slice(0, 20)}... subscribed to ${uri}`);
      } else {
        scope.logger.verbose(`resources/subscribe: Session ${sessionId.slice(0, 20)}... already subscribed to ${uri}`);
      }

      // Per MCP spec, return empty result
      return {};
    },
  } satisfies McpHandler<SubscribeRequest, EmptyResult>;
}
