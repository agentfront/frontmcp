import { SubscribeEventRequestSchema, type SubscribeEventRequest, type SubscribeEventResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/** `events/subscribe` (MCP Events, SEP-3415): create or refresh a webhook subscription, through `events:subscribe`. */
export default function eventsSubscribeRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SubscribeEventRequest, SubscribeEventResult> {
  const logger = scope.logger.child('events-subscribe-request-handler');

  return {
    requestSchema: SubscribeEventRequestSchema,
    handler: async (request: SubscribeEventRequest, ctx) => {
      logger.verbose(`events/subscribe requested for "${request.params.name}"`);
      try {
        return await scope.runFlowForOutput('events:subscribe', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
