import { PollEventsRequestSchema, type PollEventsRequest, type PollEventsResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/** `events/poll` (MCP Events, SEP-3415): the occurrences of an event since a cursor, through the `events:poll` flow. */
export default function eventsPollRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<PollEventsRequest, PollEventsResult> {
  const logger = scope.logger.child('events-poll-request-handler');

  return {
    requestSchema: PollEventsRequestSchema,
    handler: async (request: PollEventsRequest, ctx) => {
      logger.verbose(`events/poll requested for "${request.params.name}"`);
      try {
        return await scope.runFlowForOutput('events:poll', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  };
}
