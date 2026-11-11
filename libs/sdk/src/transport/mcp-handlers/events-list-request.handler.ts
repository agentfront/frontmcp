import { ListEventsRequestSchema, type ListEventsRequest, type ListEventsResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/** `events/list` (MCP Events, SEP-3415): the event types the caller can subscribe to, through the `events:list` flow. */
export default function eventsListRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListEventsRequest, ListEventsResult> {
  const logger = scope.logger.child('events-list-request-handler');

  return {
    requestSchema: ListEventsRequestSchema,
    handler: async (request: ListEventsRequest, ctx) => {
      logger.verbose('events/list requested');
      try {
        return await scope.runFlowForOutput('events:list', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
