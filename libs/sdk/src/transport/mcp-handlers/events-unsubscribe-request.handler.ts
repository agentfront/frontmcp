import {
  UnsubscribeEventRequestSchema,
  type UnsubscribeEventRequest,
  type UnsubscribeEventResult,
} from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/** `events/unsubscribe` (MCP Events, SEP-3415): remove a webhook subscription, through `events:unsubscribe`. */
export default function eventsUnsubscribeRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<UnsubscribeEventRequest, UnsubscribeEventResult> {
  const logger = scope.logger.child('events-unsubscribe-request-handler');

  return {
    requestSchema: UnsubscribeEventRequestSchema,
    handler: async (request: UnsubscribeEventRequest, ctx) => {
      logger.verbose(`events/unsubscribe requested for "${request.params.name}"`);
      try {
        return await scope.runFlowForOutput('events:unsubscribe', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
